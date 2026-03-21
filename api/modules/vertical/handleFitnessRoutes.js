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
const { getSequelize } = require('../../db/sequelize');
const { AccessSubject, VerticalEngagementSignal } = require('../../db/models');
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

  // ── GET /api/fitness/students/search ─────────────────────────────────────
  if (method === 'GET' && pathname === '/api/fitness/students/search') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const query = safeLower(urlObj.searchParams.get('q') || '');
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 20, 1), 100);

    const membershipsResult = await fitnessMembershipService.listFitnessMemberships({
      tenantId: tenantId(req),
      limit: 500,
    }).catch(() => ({ items: [] }));

    const memberships = membershipsResult.items || [];
    const subjectIds = Array.from(new Set(memberships.map((item) => safeString(item.subject_id || item.subjectId || '')).filter(Boolean)));

    let subjectsById = new Map();
    if (dbAvailable() && subjectIds.length) {
      const rows = await AccessSubject().findAll({
        where: {
          tenant_key: tenantId(req),
          id: { [Op.in]: subjectIds },
        },
        limit: 500,
      }).catch(() => []);
      subjectsById = new Map(rows.map((row) => {
        const item = row.toJSON ? row.toJSON() : row;
        return [safeString(item.id), item];
      }));
    }

    const items = memberships
      .map((membership) => {
        const subjectId = membership.subject_id || membership.subjectId;
        const subject = subjectsById.get(safeString(subjectId));
        const metadata = subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
        const effective = membership.effectiveBillingStatus || membership.billing_status || membership.billingStatus || 'inactive';
        const accessMessage = accessMessageFromStatus(effective);
        return {
          subjectId,
          membershipId: membership.id,
          customerId: membership.customer_id || membership.customerId || subject?.customer_id || null,
          name: metadata.name || metadata.fullName || metadata.customerName || membership.customer_id || subjectId,
          document: metadata.document || metadata.cpf || metadata.cnpj || null,
          code: metadata.code || metadata.externalCode || null,
          phone: metadata.phone || metadata.whatsapp || null,
          membershipStatus: membership.status || null,
          billingStatus: membership.billing_status || membership.billingStatus || null,
          effectiveBillingStatus: effective,
          accessLabel: accessMessage.label,
          accessTone: accessMessage.tone,
        };
      })
      .filter((item) => {
        if (!query) return true;
        return [
          item.subjectId,
          item.membershipId,
          item.customerId,
          item.name,
          item.document,
          item.code,
          item.phone,
        ].some((value) => safeLower(value).includes(query));
      })
      .slice(0, limit);

    sendJson(res, 200, { items, total: items.length });
    return true;
  }

  // ── GET /api/fitness/student/:subjectId/detail ──────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/student\/([^/]+)\/detail$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectParam = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 100, 20), 300);

    let subject = null;
    if (dbAvailable()) {
      subject = await AccessSubject().findOne({
        where: {
          tenant_key: tenantId(req),
          [Op.or]: [{ id: subjectParam }, { customer_id: subjectParam }],
        },
      }).catch(() => null);
      subject = subject && subject.toJSON ? subject.toJSON() : subject;
    }

    const resolvedSubjectId = subject?.id || subjectParam;
    const metadata = subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};

    const accessStatus = await fitnessMembershipService.getMembershipAccessStatus({
      tenantId: tenantId(req),
      subjectId: resolvedSubjectId,
    }).catch(() => ({ allowed: false, reasonCode: 'unknown', membership: null }));

    const membershipId = accessStatus?.membership?.id || subject?.membership_id || null;

    const [membershipDetail, attendance, timelineResult, churnRisk, lowFrequency, billingHistory, engagementSignals] = await Promise.all([
      membershipId
        ? fitnessMembershipService.getMembershipDetail({ tenantId: tenantId(req), membershipId }).catch(() => null)
        : null,
      fitnessAttendanceService.getAttendanceHistory({ tenantId: tenantId(req), subjectId: resolvedSubjectId, windowDays: 90, limit }).catch(() => ({ items: [], frequency7d: 0, frequency30d: 0 })),
      getSubjectTimeline({ tenantId: tenantId(req), subjectId: resolvedSubjectId, limit }).catch(() => ({ items: [] })),
      fitnessChurnRisk({
        tenantId: tenantId(req),
        subjectId: resolvedSubjectId,
        membershipId,
        billingStatus: accessStatus?.membership?.billing_status || 'active',
      }).catch(() => null),
      fitnessLowFrequencySuggestion({ tenantId: tenantId(req), subjectId: resolvedSubjectId }).catch(() => null),
      membershipId
        ? fitnessMembershipService.getMembershipBillingHistory({ tenantId: tenantId(req), membershipId, limit: 30 }).catch(() => ({ items: [] }))
        : { items: [] },
      dbAvailable()
        ? VerticalEngagementSignal().findAll({
          where: {
            tenant_key: tenantId(req),
            vertical: 'fitness',
            subject_id: resolvedSubjectId,
          },
          order: [['computed_at', 'DESC']],
          limit: 20,
        }).catch(() => [])
        : [],
    ]);

    const blockCount = (billingHistory.items || []).filter((item) => {
      const toStatus = safeLower(item.toStatus || '');
      return toStatus === 'blocked' || toStatus === 'delinquent';
    }).length;

    const blockFollowUp = membershipId
      ? fitnessBlockFollowUpSuggestion({
        membershipId,
        billingStatus: accessStatus?.membership?.billing_status || 'active',
        blockCount,
      })
      : { suggestion: 'none', reason: 'membership_not_found' };

    const attendanceItems = attendance.items || [];
    const attendanceTimeline = [];
    for (const item of attendanceItems) {
      if (item.checked_in_at) {
        attendanceTimeline.push({
          timestamp: item.checked_in_at,
          eventType: 'check_in',
          status: 'success',
          channel: null,
          origin: 'vertical_attendance',
          details: {
            attendanceId: item.id,
            unitId: item.unit_id || null,
            durationMinutes: item.duration_minutes || null,
          },
        });
      }
      if (item.checked_out_at) {
        attendanceTimeline.push({
          timestamp: item.checked_out_at,
          eventType: 'check_out',
          status: item.status === 'absent' ? 'failed' : 'success',
          channel: null,
          origin: 'vertical_attendance',
          details: {
            attendanceId: item.id,
            durationMinutes: item.duration_minutes || null,
            rawStatus: item.status || null,
          },
        });
      }
    }

    const journeyTimeline = (timelineResult.items || []).map((item) => ({
      timestamp: item.occurred_at || item.created_at || null,
      eventType: item.event_type || null,
      status: normalizeJourneyStatus(item.status),
      channel: item.channel || null,
      origin: 'vertical_journey_events',
      details: item.payload || {},
    }));

    const timeline = [...attendanceTimeline, ...journeyTimeline]
      .filter((item) => !!item.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 120);

    const alerts = [];
    if (accessStatus && !accessStatus.allowed) {
      alerts.push({
        type: 'access_blocked',
        severity: 'high',
        message: `Acesso bloqueado: ${accessStatus.reasonCode}`,
      });
    }
    if ((attendance.frequency30d || 0) < 2) {
      alerts.push({
        type: 'low_frequency',
        severity: 'medium',
        message: `Baixa frequencia: ${attendance.frequency30d || 0} check-ins em 30 dias.`,
      });
    }
    if (Number(churnRisk?.score || 0) >= 0.7) {
      alerts.push({
        type: 'churn_risk',
        severity: 'high',
        message: churnRisk.reason,
      });
    }

    const accessPresentation = accessMessageFromStatus(accessStatus?.effectiveBillingStatus || accessStatus?.membership?.billing_status || 'inactive');

    sendJson(res, 200, {
      student: {
        subjectId: resolvedSubjectId,
        customerId: subject?.customer_id || accessStatus?.membership?.customer_id || null,
        membershipId,
        name: metadata.name || metadata.fullName || metadata.customerName || subject?.customer_id || resolvedSubjectId,
        document: metadata.document || metadata.cpf || metadata.cnpj || null,
        code: metadata.code || metadata.externalCode || null,
        phone: metadata.phone || metadata.whatsapp || null,
      },
      membership: membershipDetail || accessStatus?.membership || null,
      accessStatus: {
        allowed: !!accessStatus?.allowed,
        reasonCode: accessStatus?.reasonCode || null,
        effectiveBillingStatus: accessStatus?.effectiveBillingStatus || accessStatus?.membership?.billing_status || null,
        label: accessPresentation.label,
        tone: accessPresentation.tone,
      },
      attendance: {
        items: attendanceItems,
        frequency7d: attendance.frequency7d || 0,
        frequency30d: attendance.frequency30d || 0,
        total: attendance.total || attendanceItems.length,
      },
      churnRisk,
      lowFrequency,
      blockFollowUp,
      alerts,
      billingHistory: billingHistory.items || [],
      engagementSignals: (engagementSignals || []).map((row) => (row.toJSON ? row.toJSON() : row)),
      timeline,
    });
    return true;
  }

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
          const { updateBillingStatus } = require('../../services/vertical/billingOrchestrationService');
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
