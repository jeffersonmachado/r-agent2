'use strict';

/**
 * Bakery Production Service — loop previsão → produção → sobra/ruptura → aprendizado.
 *
 *   demanda prevista (ML ridge, bakeryDemandModelService)
 *     → produção recomendada (forecast × fator de segurança adaptativo)
 *     → resultado real (produzido/vendido/sobra/ruptura)
 *     → aprendizado: fator de segurança ajustado pelos últimos outcomes
 *       (rupturas sobem o fator; sobras altas descem; limitado a [1.0, 1.3])
 *
 * Persistência: vertical_production_batches (uma linha por tenant×produto×dia).
 * Sem fallback em memória: banco indisponível → persistence_required.
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { Op } = require('sequelize');
const { forecastDemand, trainDemandModel, buildDailySales } = require('./bakeryDemandModelService');

const VERTICAL = 'bakery';
const SAFETY_MIN = 1.0;
const SAFETY_MAX = 1.3;
const SAFETY_STEP = 0.05;
const LEARNING_WINDOW_DAYS = 14;

function dbAvailable() {
  return !!getSequelize();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function toDateISO(date) {
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

/**
 * Fator de segurança adaptativo: aprende com os outcomes recentes.
 * - cada dia com ruptura na janela → +SAFETY_STEP
 * - sobra média > 20% do produzido → −SAFETY_STEP
 * Limitado a [SAFETY_MIN, SAFETY_MAX]. Regra determinística sobre dados
 * reais (aprendizado do loop), não heurística de demanda.
 */
async function computeSafetyFactor({ tenantId, productKey, windowDays = LEARNING_WINDOW_DAYS } = {}) {
  const since = new Date(Date.now() - windowDays * 86400000);
  const rows = await models.VerticalProductionBatch().findAll({
    where: {
      tenant_key: String(tenantId),
      vertical: VERTICAL,
      product_key: String(productKey).toLowerCase(),
      stockout: { [Op.or]: [true, false] },
      produced_qty: { [Op.not]: null },
      created_at: { [Op.gte]: since },
    },
    limit: 100,
  }).catch(() => []);

  let factor = 1.1; // ponto de partida neutro
  let stockouts = 0;
  let leftoverRatioSum = 0;
  let withLeftover = 0;
  for (const r of rows || []) {
    const b = r.toJSON ? r.toJSON() : r;
    if (b.stockout) stockouts += 1;
    const produced = Number(b.produced_qty) || 0;
    const leftover = Number(b.leftover_qty) || 0;
    if (produced > 0) {
      leftoverRatioSum += leftover / produced;
      withLeftover += 1;
    }
  }
  factor += stockouts * SAFETY_STEP;
  const avgLeftoverRatio = withLeftover > 0 ? leftoverRatioSum / withLeftover : 0;
  if (avgLeftoverRatio > 0.2 && stockouts === 0) factor -= SAFETY_STEP;

  return {
    factor: Number(Math.min(SAFETY_MAX, Math.max(SAFETY_MIN, factor)).toFixed(2)),
    stockouts,
    avgLeftoverRatio: Number(avgLeftoverRatio.toFixed(3)),
  };
}

/**
 * Gera o plano de produção para uma data: forecast ML por produto × fator
 * adaptativo. Produtos sem modelo aparecem como insufficient_data (nunca
 * recebem quantidade inventada).
 */
async function generateProductionPlan({ tenantId, date, productKeys } = {}) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para plano de produção');
  const dateISO = toDateISO(date || new Date(Date.now() + 86400000));

  let keys = productKeys;
  if (!Array.isArray(keys) || keys.length === 0) {
    const sales = await buildDailySales({ tenantId });
    keys = Array.from(sales.keys());
  }

  const items = [];
  for (const key of keys) {
    const forecast = await forecastDemand({ tenantId, productKey: key, date: dateISO });
    if (forecast.status !== 'ok') {
      items.push({ productKey: key, date: dateISO, status: 'insufficient_data', forecastQty: null, recommendedQty: null });
      continue;
    }
    const safety = await computeSafetyFactor({ tenantId, productKey: key });
    const recommendedQty = Math.ceil(Number((forecast.forecastQty * safety.factor).toFixed(6)));
    items.push({
      productKey: key,
      date: dateISO,
      status: 'ok',
      forecastQty: forecast.forecastQty,
      safetyFactor: safety.factor,
      recentStockouts: safety.stockouts,
      recommendedQty,
      modelVersion: forecast.modelVersion,
      computedBy: 'ml_ridge_regression',
    });
  }
  return { tenantId: String(tenantId), date: dateISO, items };
}

/**
 * Registra o resultado real de uma fornada (upsert por tenant×produto×dia).
 * leftover = produced − sold; stockout explícito ou sold ≥ produced com
 * demanda insatisfeita sinalizada pelo operador (hadUnmetDemand).
 */
async function recordProductionOutcome({ tenantId, productKey, date, producedQty, soldQty, plannedQty = null, hadUnmetDemand = false, metadata = {} }) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para registrar produção');
  const key = String(productKey || '').trim().toLowerCase();
  if (!key) throw Object.assign(new Error('productKey required'), { code: 'validation_error' });
  const dateISO = toDateISO(date || new Date());

  const produced = Math.max(0, Math.floor(Number(producedQty) || 0));
  const sold = Math.max(0, Math.floor(Number(soldQty) || 0));
  const leftover = Math.max(0, produced - sold);
  // ruptura é sinalizada pelo operador (demanda insatisfeita real), nunca inferida
  const stockout = hadUnmetDemand === true;

  const Batch = models.VerticalProductionBatch();
  const existing = await Batch.findOne({
    where: { tenant_key: String(tenantId), vertical: VERTICAL, product_key: key, batch_date: dateISO },
  }).catch(() => null);

  let row;
  if (existing) {
    await existing.update({
      planned_qty: plannedQty ?? existing.planned_qty,
      produced_qty: produced,
      sold_qty: sold,
      leftover_qty: leftover,
      stockout,
      payload: { ...(existing.payload || {}), ...metadata, updatedAt: new Date().toISOString() },
    });
    row = existing.toJSON ? existing.toJSON() : existing;
  } else {
    row = await Batch.create({
      id: makeId('vpb'),
      tenant_key: String(tenantId),
      vertical: VERTICAL,
      product_key: key,
      batch_date: dateISO,
      planned_qty: plannedQty,
      produced_qty: produced,
      sold_qty: sold,
      leftover_qty: leftover,
      stockout,
      computed_by: 'operator_record',
      payload: metadata,
    });
    row = row && row.toJSON ? row.toJSON() : row;
  }

  logger.info('[BakeryProduction] outcome registrado', { tenantId, productKey: key, date: dateISO, produced, sold, leftover, stockout });
  return row;
}

/**
 * Acurácia do forecast (MAPE) sobre batches com previsão e venda real.
 */
async function computeForecastAccuracy({ tenantId, windowDays = 30 } = {}) {
  const since = new Date(Date.now() - windowDays * 86400000);
  const rows = await models.VerticalProductionBatch().findAll({
    where: {
      tenant_key: String(tenantId),
      vertical: VERTICAL,
      forecast_qty: { [Op.not]: null },
      sold_qty: { [Op.not]: null },
      batch_date: { [Op.gte]: toDateISO(since) },
    },
    limit: 500,
  }).catch(() => []);

  let sum = 0;
  let n = 0;
  for (const r of rows || []) {
    const b = r.toJSON ? r.toJSON() : r;
    const actual = Number(b.sold_qty) || 0;
    const forecast = Number(b.forecast_qty) || 0;
    if (actual <= 0) continue;
    sum += Math.abs(actual - forecast) / actual;
    n += 1;
  }
  return {
    samples: n,
    mape: n > 0 ? Number((sum / n).toFixed(3)) : null,
  };
}

/**
 * Retreina os modelos de demanda de todos os produtos com histórico.
 * Produtos sem dados suficientes são pulados (fail-closed, não erro fatal).
 */
async function retrainDemandModels({ tenantId } = {}) {
  const sales = await buildDailySales({ tenantId });
  const trained = [];
  const skipped = [];
  for (const [key, perDay] of sales.entries()) {
    try {
      const result = await trainDemandModel({ tenantId, productKey: key, dailySales: perDay });
      trained.push({ productKey: key, version: result.version, samples: result.metrics.samples });
    } catch (err) {
      if (String(err?.code) === 'INSUFFICIENT_TRAINING_DATA') {
        skipped.push({ productKey: key, reason: 'insufficient_data' });
      } else {
        throw err;
      }
    }
  }
  return { trained, skipped };
}

module.exports = {
  VERTICAL,
  SAFETY_MIN,
  SAFETY_MAX,
  computeSafetyFactor,
  generateProductionPlan,
  recordProductionOutcome,
  computeForecastAccuracy,
  retrainDemandModels,
};
