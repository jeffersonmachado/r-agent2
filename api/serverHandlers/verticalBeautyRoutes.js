'use strict';

/**
 * Beauty Vertical Routes
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as accessControlRoutes.js.
 *
 * Endpoints:
 * GET  /api/beauty/journey/:subjectId         – customer journey timeline
 * POST /api/beauty/journey/event              – emit a journey event
 * GET  /api/beauty/reminders/:subjectId       – upcoming/sent reminders
 * GET  /api/beauty/no-show-risk/:subjectId    – no-show risk score
 * GET  /api/beauty/bundle/:subjectId          – session bundle balance
 * POST /api/beauty/bundle                     – create session bundle
 * POST /api/beauty/service-completed         – record service completion
 * POST /api/beauty/no-show                    – detect no-show
 * GET  /api/beauty/metrics                    – vertical KPIs
 * GET  /api/beauty/recommendations/:subjectId – AI/heuristic recommendations
 */

const { listJourneyEvents, getSubjectTimeline } = require('../services/vertical/customerJourneyEngine');
const beautyJourneyService = require('../services/vertical/beautyJourneyService');
const { createSessionBundle } = require('../services/vertical/billingOrchestrationService');
const { beautyNoShowRisk, beautyReengagementSuggestion, beautyUpsellSuggestion, beautyBestScheduleSuggestion } = require('../services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../services/vertical/verticalMetricsEngine');

const VERTICAL = 'beauty';

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

async function handleBeautyRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant, requirePermission, logger } = deps;

  if (!pathname.startsWith('/api/beauty')) return false;

  // ── GET /api/beauty/journey/:subjectId ──────────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/journey\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const customerId = urlObj.searchParams.get('customerId') || null;
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, customerId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/beauty/journey/event ──────────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/journey/event') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.eventType) { badRequest(res, 'eventType required'); return true; }

    const { listJourneyEvents: _, emitJourneyEvent } = require('../services/vertical/customerJourneyEngine');
    const evt = await emitJourneyEvent({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      eventType: body.eventType,
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      membershipId: body.membershipId || null,
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

  // ── GET /api/beauty/reminders/:subjectId ────────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/reminders\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const result = await listJourneyEvents({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      subjectId,
      // Return all reminder event types
    });
    const reminders = result.items.filter((e) => ['confirmation_sent', 'reminder_24h', 'reminder_1h'].includes(e.event_type));
    sendJson(res, 200, { items: reminders, total: reminders.length });
    return true;
  }

  // ── GET /api/beauty/no-show-risk/:subjectId ─────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/no-show-risk\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const urlObj = new URL(req.url || '/', 'http://localhost');

    const noShowCount = Number(urlObj.searchParams.get('noShowCount')) || 0;
    const totalAppointments = Number(urlObj.searchParams.get('totalAppointments')) || 0;
    const result = await beautyNoShowRisk({
      tenantId: tenantId(req),
      subjectId,
      noShowCount,
      totalAppointments,
    });
    sendJson(res, 200, result);
    return true;
  }

  // ── GET /api/beauty/bundle/:subjectId ───────────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/bundle\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const balance = await beautyJourneyService.getCustomerSessionBalance({ tenantId: tenantId(req), subjectId });
    sendJson(res, 200, balance);
    return true;
  }

  // ── POST /api/beauty/bundle ─────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/bundle') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const bundle = await createSessionBundle({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      membershipId: body.membershipId || null,
      bundleType: body.bundleType || 'package',
      planName: body.planName || null,
      totalSessions: body.totalSessions || null,
      startAt: body.startAt || null,
      endAt: body.endAt || null,
      dueDate: body.dueDate || null,
      renewalAt: body.renewalAt || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: bundle });
    return true;
  }

  // ── POST /api/beauty/service-completed ──────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/service-completed') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.recordServiceCompleted({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      bundleId: body.bundleId || null,
      correlationId: body.correlationId || null,
      loyaltyPoints: body.loyaltyPoints !== undefined ? Number(body.loyaltyPoints) : 1,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // ── POST /api/beauty/no-show ─────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/no-show') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    const evt = await beautyJourneyService.detectNoShow({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // ── GET /api/beauty/metrics ──────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/beauty/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/beauty/recommendations/:subjectId ───────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/recommendations\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const noShowCount = Number(urlObj.searchParams.get('noShowCount')) || 0;
    const totalAppointments = Number(urlObj.searchParams.get('totalAppointments')) || 0;

    const [noShowRisk, reengagement, upsell, schedule] = await Promise.all([
      beautyNoShowRisk({ tenantId: tenantId(req), subjectId, noShowCount, totalAppointments }).catch(() => null),
      beautyReengagementSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
      beautyUpsellSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
      beautyBestScheduleSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
    ]);

    sendJson(res, 200, { subjectId, noShowRisk, reengagement, upsell, schedule });
    return true;
  }

  // ── GET /api/beauty/loyalty/:subjectId ───────────────────────────────────
  // Returns loyalty point balance computed from event_ledger
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/loyalty\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const { getLoyaltyBalance } = require('../services/vertical/beautyJourneyService');
    const balance = await getLoyaltyBalance({ tenantId: tenantId(req), subjectId }).catch(() => ({ points: 0, granted: 0, reversed: 0 }));
    sendJson(res, 200, balance);
    return true;
  }

  // ── POST /api/beauty/confirmation ────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/confirmation') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.sendConfirmation({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // ── POST /api/beauty/reactivation ────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/beauty/reactivation') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.sendReactivation({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  return false;
}

module.exports = { handleBeautyRoutes };
