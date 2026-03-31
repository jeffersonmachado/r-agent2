'use strict';

/**
 * Student-facing aggregation routes for Fitness vertical.
 * GET /api/fitness/students/search
 * GET /api/fitness/student/:subjectId/detail
 */

const fitnessMembershipService = require('../../services/vertical/fitnessMembershipService');
const fitnessAttendanceService = require('../../services/vertical/fitnessAttendanceService');
const accessControlService = require('../access-control/accessControlService');
const { fitnessChurnRisk, fitnessLowFrequencySuggestion, fitnessBlockFollowUpSuggestion } = require('../../services/vertical/verticalRecommendationService');
const { getSubjectTimeline } = require('../../services/vertical/customerJourneyEngine');
const { AccessSubject, VerticalEngagementSignal } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { Op } = require('sequelize');

function dbAvailable() {
  return !!getSequelize();
}

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
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

async function handleFitnessStudentRoutes(ctx) {
  const { req, res, method, pathname, deps, ensureAuth, tenantId } = ctx;
  const { sendJson, requireAuth, requireTenant, badRequest, hasJsonContentType, parseJsonBody } = deps;

  // ── POST /api/fitness/student ───────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/fitness/student') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId && !body?.customerId) { badRequest(res, 'subjectId or customerId required'); return true; }

    const subject = await accessControlService.ensureSubject({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      membershipId: body.membershipId || null,
      verticalProfile: 'fitness',
      metadata: {
        name: body.name || null,
        phone: body.phone || null,
        email: body.email || null,
        document: body.document || null,
        code: body.code || null,
        ...(body.metadata || {}),
      },
    });

    let membership = null;
    if (body.membershipId) {
      membership = await accessControlService.upsertMembership({
        tenantId: tenantId(req),
        subjectId: subject.id,
        membershipId: body.membershipId,
        vertical: 'fitness',
        customerId: body.customerId || null,
        planName: body.planName || null,
        billingStatus: body.billingStatus || 'active',
        status: body.status || 'active',
        unitScope: body.unitScope || [],
        metadata: {
          monthlyAmount: body.monthlyAmount != null ? Number(body.monthlyAmount) : null,
          phone: body.phone || null,
          ...(body.membershipMetadata || {}),
        },
      });

      if (body.startAt || body.endAt || body.dueDate || body.renewalAt || body.planType) {
        membership = await fitnessMembershipService.updateMembershipDetails({
          tenantId: tenantId(req),
          membershipId: body.membershipId,
          fields: {
            start_at: body.startAt || undefined,
            end_at: body.endAt || undefined,
            due_date: body.dueDate || undefined,
            renewal_at: body.renewalAt || undefined,
            plan_type: body.planType || undefined,
            plan_name: body.planName || undefined,
            metadata: {
              monthlyAmount: body.monthlyAmount != null ? Number(body.monthlyAmount) : null,
              phone: body.phone || null,
              ...(body.membershipMetadata || {}),
            },
          },
        }).catch(() => membership);
      }
    }

    sendJson(res, 201, { subject, membership });
    return true;
  }

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

  return false;
}

module.exports = { handleFitnessStudentRoutes };
