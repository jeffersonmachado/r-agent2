'use strict';

/**
 * Fitness Vertical Routes
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as accessControlRoutes.js.
 *
 * Endpoints:
 * GET  /api/fitness/subject/:subjectId/attendance   – attendance history + frequency
 * POST /api/fitness/attendance/check-in              – record check-in
 * POST /api/fitness/attendance/check-out             – record check-out
 * GET  /api/fitness/membership/:membershipId         – membership detail + effective status
 * PATCH /api/fitness/membership/:membershipId/billing – update billing status
 * PATCH /api/fitness/membership/:membershipId/details – update dates / plan_type
 * POST /api/fitness/membership/:membershipId/grace-period – start grace period
 * POST /api/fitness/membership/:membershipId/renew   – process renewal
 * GET  /api/fitness/subject/:subjectId/access-status – access eligibility
 * GET  /api/fitness/subject/:subjectId/churn-risk    – churn risk score
 * GET  /api/fitness/subject/:subjectId/timeline      – operational timeline
 * GET  /api/fitness/metrics                          – vertical KPIs
 * GET  /api/fitness/memberships                      – list memberships by tenant
 * POST /api/fitness/journey/event                    – emit journey event
 */

const fitnessMembershipService = require('../services/vertical/fitnessMembershipService');
const fitnessAttendanceService = require('../services/vertical/fitnessAttendanceService');
const { fitnessChurnRisk, fitnessLowFrequencySuggestion, fitnessBlockFollowUpSuggestion } = require('../services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline } = require('../services/vertical/customerJourneyEngine');
const { emitJourneyEvent } = require('../services/vertical/customerJourneyEngine');

const VERTICAL = 'fitness';

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

async function handleFitnessRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant, requirePermission, logger } = deps;

  if (!pathname.startsWith('/api/fitness')) return false;

  // ── GET /api/fitness/subject/:subjectId/attendance ──────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/subject\/([^/]+)\/attendance$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 90;
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await fitnessAttendanceService.getAttendanceHistory({ tenantId: tenantId(req), subjectId, windowDays, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/fitness/attendance/check-in ────────────────────────────────
  if (method === 'POST' && pathname === '/api/fitness/attendance/check-in') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const att = await fitnessAttendanceService.recordCheckIn({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      membershipId: body.membershipId || null,
      accessDecisionId: body.accessDecisionId || null,
      unitId: body.unitId || null,
      deviceId: body.deviceId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: att });
    return true;
  }

  // ── POST /api/fitness/attendance/check-out ───────────────────────────────
  if (method === 'POST' && pathname === '/api/fitness/attendance/check-out') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const att = await fitnessAttendanceService.recordCheckOut({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      accessDecisionId: body.accessDecisionId || null,
      attendanceId: body.attendanceId || null,
      deviceId: body.deviceId || null,
      metadata: body.metadata || {},
    });
    if (!att) { sendJson(res, 404, { error: 'open_attendance_not_found' }); return true; }
    sendJson(res, 200, { item: att });
    return true;
  }

  // ── GET /api/fitness/membership/:membershipId ────────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const membershipId = decodeURIComponent(pathname.split('/').pop());
    const detail = await fitnessMembershipService.getMembershipDetail({ tenantId: tenantId(req), membershipId });
    if (!detail) { sendJson(res, 404, { error: 'membership_not_found' }); return true; }
    sendJson(res, 200, { item: detail });
    return true;
  }

  // ── PATCH /api/fitness/membership/:membershipId/billing ──────────────────
  if (method === 'PATCH' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/billing$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    if (!body?.toStatus) { badRequest(res, 'toStatus required'); return true; }
    try {
      const updated = await fitnessMembershipService.reactivateMembership({
        tenantId: tenantId(req),
        membershipId,
        reason: body.reason || '',
        actor: req.agent?.username || 'operator',
      });
      // If toStatus is explicitly 'blocked', use block
      const actual = body.toStatus === 'active'
        ? updated
        : await (async () => {
          const { updateBillingStatus } = require('../services/vertical/billingOrchestrationService');
          return updateBillingStatus({ tenantId: tenantId(req), membershipId, toStatus: body.toStatus, reason: body.reason || '', actor: req.agent?.username || 'operator' });
        })();
      sendJson(res, 200, { item: actual });
    } catch (err) {
      if (err.code === 'membership_not_found') { sendJson(res, 404, { error: err.code }); return true; }
      if (err.code === 'invalid_billing_transition') { sendJson(res, 422, { error: err.code, message: err.message }); return true; }
      throw err;
    }
    return true;
  }

  // ── PATCH /api/fitness/membership/:membershipId/details ──────────────────
  if (method === 'PATCH' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/details$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    const updated = await fitnessMembershipService.updateMembershipDetails({ tenantId: tenantId(req), membershipId, fields: body });
    if (!updated) { sendJson(res, 404, { error: 'membership_not_found' }); return true; }
    sendJson(res, 200, { item: updated });
    return true;
  }

  // ── POST /api/fitness/membership/:membershipId/grace-period ───────────────
  if (method === 'POST' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/grace-period$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    const updated = await fitnessMembershipService.startGracePeriod({
      tenantId: tenantId(req),
      membershipId,
      graceDays: body?.graceDays || 7,
      actor: req.agent?.username || 'operator',
    });
    sendJson(res, 200, { item: updated });
    return true;
  }

  // ── POST /api/fitness/membership/:membershipId/renew ──────────────────────
  if (method === 'POST' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/renew$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    if (!body?.renewalAt) { badRequest(res, 'renewalAt required'); return true; }
    const updated = await fitnessMembershipService.processMembershipRenewal({
      tenantId: tenantId(req),
      membershipId,
      renewalAt: body.renewalAt,
      actor: req.agent?.username || 'operator',
    });
    sendJson(res, 200, { item: updated });
    return true;
  }

  // ── GET /api/fitness/subject/:subjectId/access-status ────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/subject\/([^/]+)\/access-status$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const result = await fitnessMembershipService.getMembershipAccessStatus({ tenantId: tenantId(req), subjectId });
    sendJson(res, 200, result);
    return true;
  }

  // ── GET /api/fitness/subject/:subjectId/churn-risk ───────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/subject\/([^/]+)\/churn-risk$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const billingStatus = urlObj.searchParams.get('billingStatus') || 'active';

    const [churnRisk, lowFrequency] = await Promise.all([
      fitnessChurnRisk({ tenantId: tenantId(req), subjectId, billingStatus }).catch(() => null),
      fitnessLowFrequencySuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
    ]);
    sendJson(res, 200, { subjectId, churnRisk, lowFrequency });
    return true;
  }

  // ── GET /api/fitness/subject/:subjectId/timeline ─────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/subject\/([^/]+)\/timeline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── GET /api/fitness/metrics ─────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/fitness/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/fitness/memberships ─────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/fitness/memberships') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const billingStatus = urlObj.searchParams.get('billingStatus') || null;
    const status = urlObj.searchParams.get('status') || null;
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await fitnessMembershipService.listFitnessMemberships({ tenantId: tenantId(req), billingStatus, status, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/fitness/journey/event ──────────────────────────────────────
  if (method === 'POST' && pathname === '/api/fitness/journey/event') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.eventType) { badRequest(res, 'eventType required'); return true; }
    const evt = await emitJourneyEvent({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      eventType: body.eventType,
      subjectId: body.subjectId || null,
      membershipId: body.membershipId || null,
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

  // ── GET /api/fitness/attendance/open ─────────────────────────────────────
  if (method === 'GET' && pathname === '/api/fitness/attendance/open') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const unitId = urlObj.searchParams.get('unitId') || null;
    const limit = Number(urlObj.searchParams.get('limit')) || 50;
    const result = await fitnessAttendanceService.listOpenAttendances({ tenantId: tenantId(req), unitId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── GET /api/fitness/membership/:membershipId/billing-history ─────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/billing-history$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 50;
    const result = await fitnessMembershipService.getMembershipBillingHistory({ tenantId: tenantId(req), membershipId, limit });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = { handleFitnessRoutes };
