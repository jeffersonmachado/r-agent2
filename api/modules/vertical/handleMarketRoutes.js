'use strict';

/**
 * Market Vertical Routes (varejo/ecommerce)
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as handleFoodRoutes.js / handleServicesRoutes.js.
 *
 * Endpoints:
 * GET  /api/market/dashboard                 – vertical dashboard (orders + journey KPIs + recompra)
 * GET  /api/market/metrics                   – vertical KPIs (customer journey metrics)
 * GET  /api/market/subject/:subjectId/timeline – operational timeline
 * POST /api/market/purchase                  – record purchase completed on the journey
 * POST /api/market/journey/event             – emit journey event
 */

const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline, emitJourneyEvent } = require('../../services/vertical/customerJourneyEngine');
const marketJourneyService = require('../../services/vertical/marketJourneyService');
const { getOrderMetrics } = require('../../services/orderService');
const { getSequelize } = require('../../db/sequelize');
const { VerticalJourneyEvent, BillingTransaction, Order } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'market';

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

/**
 * Taxa de recompra: clientes com 2+ pedidos entregues na janela / clientes
 * com 1+ pedido entregue na janela. Regra determinística de negócio.
 */
async function computeRepeatPurchase({ tenantId, windowDays }) {
  if (!dbAvailable()) return { customers: 0, repeatCustomers: 0, repeatRate: 0 };
  const since = new Date(Date.now() - windowDays * 86400000);
  const rows = await Order().findAll({
    where: { tenant_key: tenantId, status: 'delivered', delivered_at: { [Op.gte]: since } },
    attributes: ['context'],
    limit: 5000,
  }).catch(() => []);

  const counts = new Map();
  for (const o of rows || []) {
    const row = o.toJSON ? o.toJSON() : o;
    const octx = row.context && typeof row.context === 'object' ? row.context : {};
    const customerId = octx.customerId || octx.customerSubjectId || null;
    if (!customerId) continue;
    counts.set(customerId, (counts.get(customerId) || 0) + 1);
  }
  const customers = counts.size;
  const repeatCustomers = Array.from(counts.values()).filter((n) => n >= 2).length;
  return {
    customers,
    repeatCustomers,
    repeatRate: customers > 0 ? Number((repeatCustomers / customers).toFixed(3)) : 0,
  };
}

async function handleMarketRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant } = deps;

  if (!pathname.startsWith('/api/market/')) return false;

  // ── GET /api/market/metrics ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/market/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/market/dashboard ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/market/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);
    const tid = tenantId(req);

    const countJourney = (eventType) => (dbAvailable()
      ? VerticalJourneyEvent().count({
        where: { tenant_key: tid, vertical: VERTICAL, event_type: eventType, occurred_at: { [Op.gte]: since } },
      }).catch(() => 0)
      : 0);

    const [orderMetrics, journeyMetrics, reviewRows, restockRows, loyaltyRows, repeat, revenueRows] = await Promise.all([
      getOrderMetrics({ tenantId: tid }).catch(() => null),
      computeVerticalMetrics({ tenantId: tid, vertical: VERTICAL, windowDays }).catch(() => null),
      countJourney('review_requested'),
      countJourney('restock_reminder_sent'),
      countJourney('loyalty_campaign_sent'),
      computeRepeatPurchase({ tenantId: tid, windowDays }),
      dbAvailable()
        ? BillingTransaction().findAll({
          where: { tenant_key: tid, vertical: VERTICAL, status: 'confirmed', created_at: { [Op.gte]: since } },
          attributes: ['amount'],
          limit: 5000,
        }).catch(() => [])
        : [],
    ]);

    const revenue = (revenueRows || []).reduce((acc, row) => {
      const d = row.toJSON ? row.toJSON() : row;
      return acc + Number(d.amount || 0);
    }, 0);

    const today = orderMetrics?.today || {};
    sendJson(res, 200, {
      vertical: VERTICAL,
      windowDays,
      metrics: journeyMetrics,
      orderMetrics,
      repeatPurchase: repeat,
      kpis: {
        ordersDeliveredToday: Number(today.deliveredCount || 0),
        ordersInFlight: Number(today.confirmedCount || 0) + Number(today.preparingCount || 0) + Number(today.readyCount || 0) + Number(today.dispatchedCount || 0),
        customersWithPurchases: Number(repeat.customers || 0),
        repeatCustomers: Number(repeat.repeatCustomers || 0),
        repeatRate: Number(repeat.repeatRate || 0),
        reviewsRequested: Number(reviewRows || 0),
        restockRemindersSent: Number(restockRows || 0),
        loyaltyCampaignsSent: Number(loyaltyRows || 0),
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // ── GET /api/market/subject/:subjectId/timeline ──────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/market\/subject\/([^/]+)\/timeline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/market/purchase ────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/market/purchase') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.orderId) { badRequest(res, 'orderId required'); return true; }
    const evt = await marketJourneyService.recordPurchaseCompleted({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      orderId: body.orderId,
      orderNumber: body.orderNumber || null,
      amount: body.amount ?? null,
      items: Array.isArray(body.items) ? body.items : [],
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: { ...(body.metadata || {}), triggeredBy: body.triggeredBy || 'manual' },
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // ── POST /api/market/journey/event ───────────────────────────────────────
  if (method === 'POST' && pathname === '/api/market/journey/event') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.eventType) { badRequest(res, 'eventType required'); return true; }
    const evt = await emitJourneyEvent({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      eventType: body.eventType,
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      channel: body.channel || 'internal',
      triggeredBy: body.triggeredBy || 'manual',
      correlationId: body.correlationId || null,
      idempotencyKey: body.idempotencyKey || null,
      payload: body.payload || {},
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  return false;
}

module.exports = { handleMarketRoutes, computeRepeatPurchase };
