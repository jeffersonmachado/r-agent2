'use strict';

/**
 * Bakery Vertical Routes — loop previsão→produção→sobra/ruptura.
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 *
 * Endpoints:
 * GET  /api/bakery/dashboard          – fornadas: produzido/vendido/sobra/ruptura + acurácia + plano
 * GET  /api/bakery/production/plan    – plano de produção (forecast ML × fator adaptativo)
 * POST /api/bakery/production/plan    – gera/salva plano para uma data
 * POST /api/bakery/production/outcome – registra resultado real da fornada
 * POST /api/bakery/production/retrain – retreina modelos de demanda do tenant
 */

const bakeryProductionService = require('../../services/vertical/bakeryProductionService');
const { getSequelize } = require('../../db/sequelize');
const { VerticalProductionBatch } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'bakery';

function dbAvailable() {
  return !!getSequelize();
}

function ensureAuth(req, res, deps) {
  const { requireAuth, sendJson, requireTenant } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) return false;
  return true;
}

function tenantId(req) {
  return req.tenantId || req.agent?.tenantId || null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function handleBakeryRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant } = deps;

  if (!pathname.startsWith('/api/bakery/')) return false;

  // ── GET /api/bakery/dashboard ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/bakery/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const tid = tenantId(req);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const date = String(urlObj.searchParams.get('date') || todayISO()).slice(0, 10);

    const [batches, accuracy, plan] = await Promise.all([
      dbAvailable()
        ? VerticalProductionBatch().findAll({
          where: { tenant_key: tid, vertical: VERTICAL, batch_date: date },
          order: [['product_key', 'ASC']],
          limit: 200,
        }).catch(() => [])
        : [],
      bakeryProductionService.computeForecastAccuracy({ tenantId: tid }).catch(() => null),
      bakeryProductionService.generateProductionPlan({ tenantId: tid, date }).catch(() => null),
    ]);

    const rows = (batches || []).map((b) => (b.toJSON ? b.toJSON() : b));
    const produced = rows.reduce((acc, b) => acc + (Number(b.produced_qty) || 0), 0);
    const sold = rows.reduce((acc, b) => acc + (Number(b.sold_qty) || 0), 0);
    const leftover = rows.reduce((acc, b) => acc + (Number(b.leftover_qty) || 0), 0);
    const stockouts = rows.filter((b) => b.stockout).length;

    sendJson(res, 200, {
      vertical: VERTICAL,
      date,
      batches: rows,
      plan,
      kpis: {
        productsPlanned: plan ? plan.items.length : 0,
        productsWithForecast: plan ? plan.items.filter((i) => i.status === 'ok').length : 0,
        batchesRecorded: rows.length,
        producedQty: produced,
        soldQty: sold,
        leftoverQty: leftover,
        leftoverRatio: produced > 0 ? Number((leftover / produced).toFixed(3)) : null,
        stockouts,
        forecastMape: accuracy?.mape ?? null,
        forecastSamples: accuracy?.samples ?? 0,
      },
    });
    return true;
  }

  // ── GET /api/bakery/production/plan ──────────────────────────────────────
  if (method === 'GET' && pathname === '/api/bakery/production/plan') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const date = urlObj.searchParams.get('date') || undefined;
    const plan = await bakeryProductionService.generateProductionPlan({ tenantId: tenantId(req), date });
    sendJson(res, 200, plan);
    return true;
  }

  // ── POST /api/bakery/production/plan ─────────────────────────────────────
  if (method === 'POST' && pathname === '/api/bakery/production/plan') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    const plan = await bakeryProductionService.generateProductionPlan({
      tenantId: tenantId(req),
      date: body?.date,
      productKeys: Array.isArray(body?.productKeys) ? body.productKeys : undefined,
    });
    sendJson(res, 200, plan);
    return true;
  }

  // ── POST /api/bakery/production/outcome ──────────────────────────────────
  if (method === 'POST' && pathname === '/api/bakery/production/outcome') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.productKey) { badRequest(res, 'productKey required'); return true; }
    const batch = await bakeryProductionService.recordProductionOutcome({
      tenantId: tenantId(req),
      productKey: body.productKey,
      date: body.date,
      plannedQty: body.plannedQty ?? null,
      producedQty: body.producedQty,
      soldQty: body.soldQty,
      hadUnmetDemand: body.hadUnmetDemand === true,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: batch });
    return true;
  }

  // ── POST /api/bakery/production/retrain ──────────────────────────────────
  if (method === 'POST' && pathname === '/api/bakery/production/retrain') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const result = await bakeryProductionService.retrainDemandModels({ tenantId: tenantId(req) });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = { handleBakeryRoutes };
