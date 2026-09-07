'use strict';

/**
 * Clinic Vertical Routes
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as handleFitnessRoutes.js.
 *
 * Endpoints:
 * GET  /api/clinic/dashboard                        – vertical dashboard (metrics + KPIs)
 * GET  /api/clinic/metrics                          – vertical KPIs
 * GET  /api/clinic/subject/:subjectId/timeline      – operational timeline
 * GET  /api/clinic/subject/:subjectId/no-show-risk  – no-show risk + suggested action
 * GET  /api/clinic/subject/:subjectId/recall        – recall (retorno) suggestion
 * POST /api/clinic/journey/event                    – emit journey event
 */

const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline, emitJourneyEvent } = require('../../services/vertical/customerJourneyEngine');
const { clinicNoShowRisk, clinicRecallSuggestion } = require('../../services/vertical/verticalRecommendationService');
const { getSequelize } = require('../../db/sequelize');
const { VerticalEngagementSignal, VerticalAttendance, VerticalJourneyEvent, BillingTransaction } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'clinic';

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

async function handleClinicRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant } = deps;

  if (!pathname.startsWith('/api/clinic')) return false;

  // ── GET /api/clinic/metrics ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/clinic/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/clinic/dashboard ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/clinic/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);
    const tid = tenantId(req);

    const [metrics, noShowRiskCount, consultationsToday, recallRows, revenueRows] = await Promise.all([
      computeVerticalMetrics({ tenantId: tid, vertical: VERTICAL, windowDays }).catch(() => null),
      dbAvailable()
        ? VerticalEngagementSignal().count({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            signal_type: 'no_show_risk',
            computed_at: { [Op.gte]: since },
          },
        }).catch(() => 0)
        : 0,
      dbAvailable()
        ? VerticalAttendance().count({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            checked_in_at: { [Op.gte]: new Date(new Date().toISOString().slice(0, 10)) },
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

    sendJson(res, 200, {
      vertical: VERTICAL,
      windowDays,
      metrics,
      kpis: {
        noShowRiskPatients: Number(noShowRiskCount || 0),
        consultationsToday: Number(consultationsToday || 0),
        recallsSent: Number(recallRows || 0),
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // ── GET /api/clinic/subject/:subjectId/timeline ──────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/clinic\/subject\/([^/]+)\/timeline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── GET /api/clinic/subject/:subjectId/no-show-risk ──────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/clinic\/subject\/([^/]+)\/no-show-risk$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const noShowCount = Number(urlObj.searchParams.get('noShowCount')) || 0;
    const totalAppointments = Number(urlObj.searchParams.get('totalAppointments')) || 0;
    // Fail-closed ML policy: sem modelo treinado, retorna null (mesmo padrão fitness/beauty)
    const result = await clinicNoShowRisk({ tenantId: tenantId(req), subjectId, noShowCount, totalAppointments }).catch(() => null);
    sendJson(res, 200, { subjectId, vertical: VERTICAL, noShowRisk: result });
    return true;
  }

  // ── GET /api/clinic/subject/:subjectId/recall ────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/clinic\/subject\/([^/]+)\/recall$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const result = await clinicRecallSuggestion({ tenantId: tenantId(req), subjectId });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/clinic/journey/event ───────────────────────────────────────
  if (method === 'POST' && pathname === '/api/clinic/journey/event') {
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
      scheduleId: body.scheduleId || null,
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

module.exports = { handleClinicRoutes };
