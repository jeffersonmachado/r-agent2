'use strict';

/**
 * Food Vertical Routes
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as handleClinicRoutes.js.
 *
 * Endpoints:
 * GET  /api/food/dashboard                   – vertical dashboard (order metrics + journey KPIs)
 * GET  /api/food/metrics                     – vertical KPIs (customer journey metrics)
 * GET  /api/food/subject/:subjectId/timeline – operational timeline
 * POST /api/food/journey/event               – emit journey event
 */

const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline, emitJourneyEvent } = require('../../services/vertical/customerJourneyEngine');
const { getOrderMetrics } = require('../../services/orderService');
const { getSequelize } = require('../../db/sequelize');
const { VerticalJourneyEvent, BillingTransaction } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'food';

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

async function handleFoodRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant } = deps;

  if (!pathname.startsWith('/api/food')) return false;

  // ── GET /api/food/metrics ────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/food/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/food/dashboard ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/food/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);
    const tid = tenantId(req);

    const [orderMetrics, journeyMetrics, reviewRows, reorderRows, revenueRows] = await Promise.all([
      getOrderMetrics({ tenantId: tid }).catch(() => null),
      computeVerticalMetrics({ tenantId: tid, vertical: VERTICAL, windowDays }).catch(() => null),
      dbAvailable()
        ? VerticalJourneyEvent().count({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            event_type: 'review_requested',
            occurred_at: { [Op.gte]: since },
          },
        }).catch(() => 0)
        : 0,
      dbAvailable()
        ? VerticalJourneyEvent().count({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            event_type: 'return_campaign_sent',
            occurred_at: { [Op.gte]: since },
          },
        }).catch(() => 0)
        : 0,
      dbAvailable()
        ? BillingTransaction().findAll({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            status: 'confirmed',
            created_at: { [Op.gte]: since },
          },
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
      kpis: {
        ordersDeliveredToday: Number(today.deliveredCount || 0),
        ordersCancelledToday: Number(today.cancelledCount || 0),
        ordersInFlight: Number(today.confirmedCount || 0) + Number(today.preparingCount || 0) + Number(today.readyCount || 0) + Number(today.dispatchedCount || 0),
        avgOrderToReadySeconds: today.avgOrderToReadySeconds ?? null,
        avgOrderToDeliverSeconds: today.avgOrderToDeliverSeconds ?? null,
        slaReadyBreached: Number(today.slaOrderToReadyBreachedCount || 0),
        slaDeliverBreached: Number(today.slaOrderToDeliverBreachedCount || 0),
        reviewsRequested: Number(reviewRows || 0),
        reorderCampaignsSent: Number(reorderRows || 0),
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // ── GET /api/food/subject/:subjectId/timeline ────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/food\/subject\/([^/]+)\/timeline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/food/journey/event ─────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/food/journey/event') {
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

module.exports = { handleFoodRoutes };
