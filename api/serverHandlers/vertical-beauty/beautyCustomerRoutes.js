const { listJourneyEvents, getSubjectTimeline } = require('../../services/vertical/customerJourneyEngine');
const beautyJourneyService = require('../../services/vertical/beautyJourneyService');
const { beautyNoShowRisk, beautyReengagementSuggestion, beautyUpsellSuggestion } = require('../../services/vertical/verticalRecommendationService');
const scheduleService = require('../../services/scheduleService');
const { AccessSubject } = require('../../db/models');
const { Op } = require('sequelize');

const {
  VERTICAL,
  dbAvailable,
  safeString,
  safeLower,
  normalizeDay,
  dayWindow,
  isInsideWindow,
  mapAgendaItem,
  parseCustomerTokens,
  scheduleMatchesCustomer,
  normalizeJourneyStatus,
  ensureAuth,
  tenantId,
} = require('./beautyRouteHelpers');

async function handleBeautyCustomerRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, requireAuth, requireTenant } = deps;

  // GET /api/beauty/agenda
  if (method === 'GET' && pathname === '/api/beauty/agenda') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const day = normalizeDay(urlObj.searchParams.get('date'));
    const professionalId = safeString(urlObj.searchParams.get('professionalId') || '').trim();
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 200, 1), 1000);
    const { start, end } = dayWindow(day);

    const schedules = scheduleService.listSchedules({ tenantId: tenantId(req), limit: 1000 }).items || [];
    let items = schedules
      .filter((item) => item && item.contextType !== 'calendar_block')
      .filter((item) => isInsideWindow(item.startAt, start, end));

    if (professionalId) {
      items = items.filter((item) => {
        const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
        return [
          item.ownerId,
          item.teamId,
          metadata.professionalId,
          metadata.professionalName,
        ].some((value) => safeString(value) === professionalId);
      });
    }

    const mapped = items
      .map(mapAgendaItem)
      .sort((a, b) => new Date(a.startAt || 0).getTime() - new Date(b.startAt || 0).getTime())
      .slice(0, limit);

    const summary = {
      total: mapped.length,
      pendente: mapped.filter((item) => item.status === 'pendente').length,
      confirmado: mapped.filter((item) => item.status === 'confirmado').length,
      emAtendimento: mapped.filter((item) => item.status === 'em atendimento').length,
      concluido: mapped.filter((item) => item.status === 'concluido').length,
      noShow: mapped.filter((item) => item.status === 'no-show').length,
      cancelado: mapped.filter((item) => item.status === 'cancelado').length,
    };

    sendJson(res, 200, {
      day,
      professionalId: professionalId || null,
      summary,
      items: mapped,
      total: mapped.length,
    });
    return true;
  }

  // GET /api/beauty/customers/search
  if (method === 'GET' && pathname === '/api/beauty/customers/search') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const query = safeLower(urlObj.searchParams.get('q') || '');
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 20, 1), 100);

    const eventResult = await listJourneyEvents({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      limit: 500,
    }).catch(() => ({ items: [] }));

    const subjects = dbAvailable()
      ? await AccessSubject().findAll({
        where: {
          tenant_key: tenantId(req),
          [Op.or]: [
            { vertical_profile: 'beauty' },
            { vertical_profile: 'fitness' },
          ],
        },
        order: [['updated_at', 'DESC']],
        limit: 500,
      }).catch(() => [])
      : [];

    const latestEventByKey = new Map();
    for (const row of eventResult.items || []) {
      const key = safeString(row.subject_id || row.customer_id || '');
      if (!key || latestEventByKey.has(key)) continue;
      latestEventByKey.set(key, row.occurred_at || row.created_at || null);
    }

    const map = new Map();
    for (const row of subjects) {
      const item = row.toJSON ? row.toJSON() : row;
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const key = safeString(item.id || item.customer_id || '');
      if (!key || map.has(key)) continue;
      map.set(key, {
        subjectId: item.id || null,
        customerId: item.customer_id || null,
        name: metadata.name || metadata.fullName || metadata.customerName || item.customer_id || item.id,
        document: metadata.document || metadata.cpf || metadata.cnpj || null,
        phone: metadata.phone || metadata.whatsapp || null,
        email: metadata.email || null,
        code: metadata.code || metadata.externalCode || null,
        lastEventAt: latestEventByKey.get(key) || null,
      });
    }

    for (const row of eventResult.items || []) {
      const key = safeString(row.subject_id || row.customer_id || '');
      if (!key || map.has(key)) continue;
      map.set(key, {
        subjectId: row.subject_id || row.customer_id || null,
        customerId: row.customer_id || null,
        name: row.customer_id || row.subject_id || key,
        document: null,
        phone: null,
        email: null,
        code: null,
        lastEventAt: row.occurred_at || null,
      });
    }

    const items = Array.from(map.values())
      .filter((item) => {
        if (!query) return true;
        return [
          item.subjectId,
          item.customerId,
          item.name,
          item.document,
          item.phone,
          item.code,
        ].some((value) => safeLower(value).includes(query));
      })
      .sort((a, b) => {
        const aTs = a.lastEventAt ? new Date(a.lastEventAt).getTime() : 0;
        const bTs = b.lastEventAt ? new Date(b.lastEventAt).getTime() : 0;
        return bTs - aTs;
      })
      .slice(0, limit);

    sendJson(res, 200, { items, total: items.length });
    return true;
  }

  // GET /api/beauty/customer/:subjectId/detail
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/customer\/([^/]+)\/detail$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;

    const subjectParam = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const customerIdParam = safeString(urlObj.searchParams.get('customerId') || '').trim() || null;
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 200, 10), 500);

    let subject = null;
    if (dbAvailable()) {
      subject = await AccessSubject().findOne({
        where: {
          tenant_key: tenantId(req),
          [Op.or]: [
            { id: subjectParam },
            { customer_id: subjectParam },
          ],
        },
      }).catch(() => null);
      subject = subject && subject.toJSON ? subject.toJSON() : subject;
    }

    const resolvedSubjectId = subject?.id || subjectParam;
    const resolvedCustomerId = customerIdParam || subject?.customer_id || null;
    const customerTokens = parseCustomerTokens({ subjectId: resolvedSubjectId, customerId: resolvedCustomerId });

    const schedules = scheduleService.listSchedules({ tenantId: tenantId(req), limit: 1000 }).items || [];
    const relatedSchedules = schedules
      .filter((item) => item && item.contextType !== 'calendar_block')
      .filter((item) => scheduleMatchesCustomer(item, customerTokens))
      .map(mapAgendaItem)
      .sort((a, b) => new Date(b.startAt || 0).getTime() - new Date(a.startAt || 0).getTime());

    const now = Date.now();
    const nextAppointment = relatedSchedules
      .slice()
      .reverse()
      .find((item) => {
        const startTs = new Date(item.startAt || 0).getTime();
        if (!Number.isFinite(startTs) || startTs < now) return false;
        return !['concluido', 'cancelado', 'no-show'].includes(item.status);
      }) || null;

    const timelineResult = await getSubjectTimeline({
      tenantId: tenantId(req),
      subjectId: resolvedSubjectId,
      customerId: resolvedCustomerId,
      limit,
    }).catch(() => ({ items: [] }));

    const events = (timelineResult.items || []).map((item) => ({
      timestamp: item.occurred_at || item.created_at || null,
      eventType: item.event_type || null,
      status: normalizeJourneyStatus(item.status),
      channel: item.channel || null,
      details: item.payload || {},
      rawStatus: item.status || null,
    }));

    const noShowCount = events.filter((item) => item.eventType === 'no_show_detected').length;
    const totalAppointments = Math.max(relatedSchedules.length, events.filter((item) => item.eventType === 'confirmation_sent').length);

    const [risk, reengagement, upsell, balance] = await Promise.all([
      beautyNoShowRisk({ tenantId: tenantId(req), subjectId: resolvedSubjectId, noShowCount, totalAppointments }).catch(() => null),
      beautyReengagementSuggestion({ tenantId: tenantId(req), subjectId: resolvedSubjectId }).catch(() => null),
      beautyUpsellSuggestion({ tenantId: tenantId(req), subjectId: resolvedSubjectId }).catch(() => null),
      beautyJourneyService.getCustomerSessionBalance({ tenantId: tenantId(req), subjectId: resolvedSubjectId }).catch(() => null),
    ]);

    const automation = {
      confirmationSent: events.some((item) => item.eventType === 'confirmation_sent'),
      reminder24hSent: events.some((item) => item.eventType === 'reminder_24h'),
      reminderNearSent: events.some((item) => item.eventType === 'reminder_1h'),
      followUpSent: events.some((item) => item.eventType === 'follow_up_sent'),
      reactivationSent: events.some((item) => item.eventType === 'reactivation_sent'),
      lastEventAt: events[0]?.timestamp || null,
    };

    const score = Number(risk?.score || 0);
    const indicators = {
      noShowRiskScore: Number.isFinite(score) ? score : 0,
      noShowRiskLevel: score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low',
      eligibleForReturn: !!(reengagement && reengagement.suggestion && reengagement.suggestion !== 'none'),
      followUpStatus: automation.followUpSent ? 'sent' : 'pending',
    };

    const metadata = subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
    const customer = {
      subjectId: resolvedSubjectId,
      customerId: resolvedCustomerId,
      name: metadata.name || metadata.fullName || metadata.customerName || resolvedCustomerId || resolvedSubjectId,
      document: metadata.document || metadata.cpf || metadata.cnpj || null,
      phone: metadata.phone || metadata.whatsapp || null,
      email: metadata.email || null,
      code: metadata.code || metadata.externalCode || null,
    };

    sendJson(res, 200, {
      customer,
      nextAppointment,
      recentAppointments: relatedSchedules.slice(0, 10),
      journeyEvents: events.slice(0, 100),
      automation,
      bundle: balance,
      indicators,
      recommendations: {
        noShowRisk: risk,
        reengagement,
        upsell,
      },
    });
    return true;
  }

  return false;
}

module.exports = { handleBeautyCustomerRoutes };
