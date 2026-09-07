'use strict';

/**
 * Bakery Demand Model Service — previsão de demanda por produto com ML real.
 *
 * Modelo: regressão linear ridge (equação normal com regularização L2),
 * treinada por tenant × produto sobre o histórico de vendas (pedidos
 * entregues, últimos 90 dias).
 *
 * Features (8): bias + weekday one-hot (7).
 * Target: quantidade vendida do produto no dia.
 *
 * Persistência: vertical_ml_models (model_type 'bakery_demand:<product_key>').
 *
 * FAIL-CLOSED: sem modelo treinado (histórico insuficiente), a previsão
 * retorna status 'insufficient_data' — nunca inventa número por heurística.
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { Op } = require('sequelize');

const MODEL_TYPE_PREFIX = 'bakery_demand';
const HISTORY_DAYS = 90;
const MIN_SAMPLES = 14; // mínimo de dias com venda para treinar
const RIDGE_L2 = 1.0;

function dbAvailable() {
  return !!getSequelize();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function modelType(productKey) {
  return `${MODEL_TYPE_PREFIX}:${String(productKey).toLowerCase()}`;
}

/**
 * Extrai vendas diárias por produto dos pedidos entregues.
 * @returns {Promise<Map<productKey, Map<dateISO, qty>>>}
 */
async function buildDailySales({ tenantId, historyDays = HISTORY_DAYS } = {}) {
  const since = new Date(Date.now() - historyDays * 86400000);
  const rows = await models.Order().findAll({
    where: { tenant_key: String(tenantId), status: 'delivered', delivered_at: { [Op.gte]: since } },
    attributes: ['items', 'delivered_at'],
    limit: 10000,
  }).catch(() => []);

  const byProduct = new Map();
  for (const o of rows || []) {
    const row = o.toJSON ? o.toJSON() : o;
    if (!row.delivered_at) continue;
    const dateISO = new Date(row.delivered_at).toISOString().slice(0, 10);
    const items = Array.isArray(row.items) ? row.items : [];
    for (const item of items) {
      const name = String(item?.name || '').trim().toLowerCase();
      const qty = Number(item?.qty ?? item?.quantity ?? 1);
      if (!name || !(qty > 0)) continue;
      if (!byProduct.has(name)) byProduct.set(name, new Map());
      const perDay = byProduct.get(name);
      perDay.set(dateISO, (perDay.get(dateISO) || 0) + qty);
    }
  }
  return byProduct;
}

/** Feature vector: [1, weekday0..weekday6] */
function featureVector(dateISO) {
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const v = new Array(8).fill(0);
  v[0] = 1;
  v[1 + weekday] = 1;
  return v;
}

/**
 * Ridge regression via equação normal: w = (XᵀX + λI)⁻¹ Xᵀy.
 * Resolvida por eliminação gaussiana (matriz 8×8 — trivial).
 */
function trainRidgeRegression({ X, y, l2 = RIDGE_L2 }) {
  const n = X[0].length;
  const XtX = Array.from({ length: n }, () => new Array(n).fill(0));
  const Xty = new Array(n).fill(0);
  for (let i = 0; i < X.length; i += 1) {
    for (let a = 0; a < n; a += 1) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < n; b += 1) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 1; a < n; a += 1) XtX[a][a] += l2; // não regulariza o bias

  // Eliminação gaussiana com pivô parcial
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    w[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : M[i][n] / M[i][i];
  }
  return w;
}

function predict(weights, dateISO) {
  const x = featureVector(dateISO);
  const raw = weights.reduce((acc, w, i) => acc + w * x[i], 0);
  return Math.max(0, raw); // demanda nunca é negativa
}

/**
 * Treina (ou retreina) o modelo de demanda de um produto.
 * @throws INSUFFICIENT_TRAINING_DATA quando há poucos dias de histórico.
 */
async function trainDemandModel({ tenantId, productKey, dailySales }) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para treinar modelo de demanda');
  const key = String(productKey).toLowerCase();

  let perDay = dailySales;
  if (!perDay) {
    const all = await buildDailySales({ tenantId });
    perDay = all.get(key) || new Map();
  }

  const X = [];
  const y = [];
  for (const [dateISO, qty] of perDay.entries()) {
    X.push(featureVector(dateISO));
    y.push(qty);
  }
  if (X.length < MIN_SAMPLES) {
    throw Object.assign(
      new Error(`INSUFFICIENT_TRAINING_DATA: produto=${key} amostras=${X.length} (mínimo ${MIN_SAMPLES})`),
      { code: 'INSUFFICIENT_TRAINING_DATA' },
    );
  }

  const weights = trainRidgeRegression({ X, y });

  // Métrica de treino: MAE in-sample (referência, não usada para decisão)
  const mae = X.reduce((acc, x, i) => {
    const pred = Math.max(0, weights.reduce((a, w, j) => a + w * x[j], 0));
    return acc + Math.abs(pred - y[i]);
  }, 0) / X.length;

  const Model = models.VerticalMlModel();
  const type = modelType(key);
  const latest = await Model.findOne({
    where: { tenant_key: String(tenantId), model_type: type },
    order: [['version', 'DESC']],
  }).catch(() => null);
  const version = (latest ? Number((latest.toJSON ? latest.toJSON() : latest).version) || 0 : 0) + 1;

  await Model.update(
    { status: 'superseded' },
    { where: { tenant_key: String(tenantId), model_type: type, status: 'active' } },
  ).catch(() => {});

  const row = await Model.create({
    id: makeId('vmm'),
    tenant_key: String(tenantId),
    model_type: type,
    version,
    algorithm: 'ridge_regression',
    weights: { coefficients: weights, features: ['bias', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
    metrics: { samples: X.length, mae: Number(mae.toFixed(3)), historyDays: HISTORY_DAYS },
    status: 'active',
    trained_at: new Date(),
  });

  logger.info('[BakeryDemand] modelo treinado', { tenantId, productKey: key, version, samples: X.length, mae: Number(mae.toFixed(3)) });
  const plain = row.toJSON ? row.toJSON() : row;
  return { id: plain.id, version, metrics: plain.metrics };
}

/**
 * Previsão de demanda. FAIL-CLOSED: sem modelo ativo, retorna
 * { status: 'insufficient_data' } — nunca heurística.
 */
async function forecastDemand({ tenantId, productKey, date }) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para previsão de demanda');
  const key = String(productKey).toLowerCase();
  const Model = models.VerticalMlModel();
  const row = await Model.findOne({
    where: { tenant_key: String(tenantId), model_type: modelType(key), status: 'active' },
    order: [['version', 'DESC']],
  }).catch(() => null);
  if (!row) return { status: 'insufficient_data', productKey: key };

  const model = row.toJSON ? row.toJSON() : row;
  const weights = model.weights?.coefficients;
  if (!Array.isArray(weights) || weights.length !== 8) return { status: 'insufficient_data', productKey: key };

  const dateISO = (date instanceof Date ? date : new Date(`${date}T12:00:00Z`)).toISOString().slice(0, 10);
  const qty = predict(weights, dateISO);
  return {
    status: 'ok',
    productKey: key,
    date: dateISO,
    forecastQty: Number(qty.toFixed(2)),
    modelVersion: Number(model.version) || 1,
    computedBy: 'ml_ridge_regression',
  };
}

module.exports = {
  MODEL_TYPE_PREFIX,
  MIN_SAMPLES,
  buildDailySales,
  featureVector,
  trainRidgeRegression,
  trainDemandModel,
  forecastDemand,
};
