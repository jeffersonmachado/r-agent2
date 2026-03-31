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

const fitnessMembershipService = require('../../services/vertical/fitnessMembershipService');
const fitnessAttendanceService = require('../../services/vertical/fitnessAttendanceService');
const { fitnessChurnRisk, fitnessLowFrequencySuggestion, fitnessBlockFollowUpSuggestion } = require('../../services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline } = require('../../services/vertical/customerJourneyEngine');
const { emitJourneyEvent } = require('../../services/vertical/customerJourneyEngine');
const { handleFitnessMembershipRoutes } = require('./handleFitnessMembershipRoutes');
const { handleFitnessAttendanceRoutes } = require('./handleFitnessAttendanceRoutes');
const { handleFitnessStudentRoutes } = require('./handleFitnessStudentRoutes');
const { getSequelize } = require('../../db/sequelize');
const { AccessSubject, VerticalEngagementSignal, VerticalAttendance, BillingTransaction } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'fitness';

function dbAvailable() {
  return !!getSequelize();
}

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeLower(value) {
  return safeString(value, '').trim().toLowerCase();
}

function accessMessageFromStatus(statusValue) {
  const status = safeLower(statusValue);
  if (status === 'active') return { label: 'liberado', tone: 'success' };
  if (status === 'grace_period') return { label: 'grace period', tone: 'warning' };
  if (status === 'delinquent') return { label: 'delinquent', tone: 'error' };
  if (status === 'blocked') return { label: 'bloqueado', tone: 'error' };
  if (status === 'cancelled' || status === 'inactive') return { label: 'inativo', tone: 'neutral' };
  return { label: 'provider-dependent', tone: 'neutral' };
}

function normalizeJourneyStatus(statusValue) {
  const value = safeLower(statusValue);
  if (value === 'failed' || value === 'error') return 'failed';
  if (value === 'pending') return 'pending';
  return 'success';
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

async function handleFitnessRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant, requirePermission, logger } = deps;

  if (!pathname.startsWith('/api/fitness')) return false;

  // ── student search + detail → handleFitnessStudentRoutes ─────────────────
  const studentHandled = await handleFitnessStudentRoutes({
    req,
    res,
    method,
    pathname,
    deps: { sendJson, requireAuth, requireTenant, badRequest, hasJsonContentType, parseJsonBody },
    ensureAuth,
    tenantId,
  });
  if (studentHandled) return true;

  const attendanceHandled = await handleFitnessAttendanceRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      requireAuth,
      requireTenant,
    },
    ensureAuth,
    tenantId,
  });
  if (attendanceHandled) return true;

  const membershipHandled = await handleFitnessMembershipRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      requireAuth,
      requireTenant,
    },
    ensureAuth,
    tenantId,
  });
  if (membershipHandled) return true;

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

  // ── GET /api/fitness/dashboard ──────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/fitness/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);

    const [metrics, riskCount, attendanceToday, revenueRows] = await Promise.all([
      computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays }).catch(() => null),
      dbAvailable()
        ? VerticalEngagementSignal().count({
          where: {
            tenant_key: tenantId(req),
            vertical: VERTICAL,
            signal_type: 'churn_risk',
            computed_at: { [Op.gte]: since },
          },
        }).catch(() => 0)
        : 0,
      dbAvailable()
        ? VerticalAttendance().count({
          where: {
            tenant_key: tenantId(req),
            vertical: VERTICAL,
            checked_in_at: { [Op.gte]: new Date(new Date().toISOString().slice(0, 10)) },
          },
        }).catch(() => 0)
        : 0,
      dbAvailable()
        ? BillingTransaction().findAll({
          where: {
            tenant_key: tenantId(req),
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
        churnRiskSubjects: Number(riskCount || 0),
        attendanceToday: Number(attendanceToday || 0),
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // ── GET /api/fitness/intelligence/:subjectId ───────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/intelligence\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);

    const [churnRisk, lowFrequency, memberships] = await Promise.all([
      fitnessChurnRisk({ tenantId: tenantId(req), subjectId }).catch(() => null),
      fitnessLowFrequencySuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
      fitnessMembershipService.listFitnessMemberships({ tenantId: tenantId(req), limit: 500 }).catch(() => ({ items: [] })),
    ]);

    const membership = (memberships.items || []).find((m) => String(m.subject_id || '') === String(subjectId)) || null;
    const planSuggestion = Number(churnRisk?.score || 0) >= 0.7
      ? { suggestion: 'downgrade_friendly_plan', reason: 'Alto risco de churn; reduzir fricção financeira pode reter o aluno.' }
      : Number(churnRisk?.score || 0) >= 0.4
        ? { suggestion: 'engagement_plan', reason: 'Risco moderado; plano com metas de frequência tende a melhorar retenção.' }
        : { suggestion: 'keep_current_plan', reason: 'Risco baixo; manter plano atual.' };

    sendJson(res, 200, {
      subjectId,
      churnPrediction: churnRisk,
      frequencySuggestion: lowFrequency,
      planSuggestion,
      context: {
        membershipId: membership?.id || null,
        billingStatus: membership?.billing_status || null,
      },
    });
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

  return false;
}

module.exports = { handleFitnessRoutes };
