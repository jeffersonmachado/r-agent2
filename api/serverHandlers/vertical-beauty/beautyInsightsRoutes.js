const { beautyNoShowRisk, beautyReengagementSuggestion, beautyUpsellSuggestion, beautyBestScheduleSuggestion } = require('../../services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
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
    const { getLoyaltyBalance } = require('../../services/vertical/beautyJourneyService');
    const balance = await getLoyaltyBalance({ tenantId: tenantId(req), subjectId }).catch(() => ({ points: 0, granted: 0, reversed: 0 }));
    sendJson(res, 200, balance);
    return true;
  }

  return false;
}

module.exports = { handleBeautyInsightsRoutes };
