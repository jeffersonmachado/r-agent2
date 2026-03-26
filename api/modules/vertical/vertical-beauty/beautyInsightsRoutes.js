const { beautyNoShowRisk, beautyReengagementSuggestion, beautyUpsellSuggestion, beautyBestScheduleSuggestion } = require('../../../services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../../../services/vertical/verticalMetricsEngine');
const { VerticalJourneyEvent, BillingTransaction } = require('../../../db/models');
const { getSequelize } = require('../../../db/sequelize');
const { Op } = require('sequelize');
const { ensureAuth, tenantId, VERTICAL } = require('./beautyRouteHelpers');

async function handleBeautyInsightsRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, requireAuth, requireTenant } = deps;

  // GET /api/beauty/no-show-risk/:subjectId
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

  // GET /api/beauty/metrics
  if (method === 'GET' && pathname === '/api/beauty/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // GET /api/beauty/dashboard
  if (method === 'GET' && pathname === '/api/beauty/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);
    const sequelizeReady = !!getSequelize();

    const [metrics, events, revenueRows] = await Promise.all([
      computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays }).catch(() => null),
      sequelizeReady
        ? VerticalJourneyEvent().findAll({
          where: {
            tenant_key: tenantId(req),
            vertical: VERTICAL,
            occurred_at: { [Op.gte]: since },
            event_type: { [Op.in]: ['no_show_detected', 'reactivation_sent', 'service_completed'] },
          },
          attributes: ['event_type'],
          limit: 5000,
        }).catch(() => [])
        : [],
      sequelizeReady
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

    const counters = { noShow: 0, reactivation: 0, loyaltyCompleted: 0 };
    for (const row of (events || [])) {
      const d = row.toJSON ? row.toJSON() : row;
      if (d.event_type === 'no_show_detected') counters.noShow += 1;
      if (d.event_type === 'reactivation_sent') counters.reactivation += 1;
      if (d.event_type === 'service_completed') counters.loyaltyCompleted += 1;
    }

    const revenue = (revenueRows || []).reduce((acc, row) => {
      const d = row.toJSON ? row.toJSON() : row;
      return acc + Number(d.amount || 0);
    }, 0);

    sendJson(res, 200, {
      vertical: VERTICAL,
      windowDays,
      metrics,
      kpis: {
        noShow: counters.noShow,
        reactivation: counters.reactivation,
        loyaltyCompleted: counters.loyaltyCompleted,
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // GET /api/beauty/recommendations/:subjectId
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

  // GET /api/beauty/loyalty/:subjectId
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/loyalty\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const { getLoyaltyBalance } = require('../../../services/vertical/beautyJourneyService');
    const balance = await getLoyaltyBalance({ tenantId: tenantId(req), subjectId }).catch(() => ({ points: 0, granted: 0, reversed: 0 }));
    sendJson(res, 200, balance);
    return true;
  }

  // GET /api/beauty/intelligence/:subjectId
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/intelligence\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());

    const [noShowRisk, reengagement, upsell, schedule] = await Promise.all([
      beautyNoShowRisk({ tenantId: tenantId(req), subjectId }).catch(() => null),
      beautyReengagementSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
      beautyUpsellSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
      beautyBestScheduleSuggestion({ tenantId: tenantId(req), subjectId }).catch(() => null),
    ]);

    const reactivationPriority = Number(noShowRisk?.score || 0) >= 0.7
      ? 'high'
      : Number(noShowRisk?.score || 0) >= 0.4 ? 'medium' : 'low';

    sendJson(res, 200, {
      subjectId,
      churnPrediction: noShowRisk,
      planSuggestion: upsell,
      reactivationIntelligence: {
        priority: reactivationPriority,
        recommendation: reengagement,
      },
      bestSchedule: schedule,
    });
    return true;
  }

  return false;
}

module.exports = { handleBeautyInsightsRoutes };
