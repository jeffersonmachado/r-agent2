'use strict';

const { getTenantIntelligenceService } = require('../../core/tenant-intelligence/TenantIntelligenceService');
const { handleIntelligenceAnalyticsRoutes } = require('./handleIntelligenceAnalyticsRoutes');
const { handleIntelligenceGoalRoutes } = require('./handleIntelligenceGoalRoutes');

function parseBooleanInput(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

async function handleIntelligenceRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (!pathname.startsWith('/api/intelligence')) return false;

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const tenantId = requireTenant(req, res);
  if (!tenantId) return true;

  const service = getTenantIntelligenceService();

  if (method === 'POST' && pathname === '/api/intelligence/search') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const question = body?.question ? String(body.question).trim() : '';
      if (!question) {
        badRequest(res, 'Campo "question" e obrigatorio');
        return true;
      }

      const mode = String(body?.mode || 'read').toLowerCase();
      const modeDefaults = mode === 'refresh'
        ? { refreshMetrics: true, refreshInsights: true, refreshRecommendations: true }
        : { refreshMetrics: false, refreshInsights: false, refreshRecommendations: false };

      const rawOptions = body?.options && typeof body.options === 'object' ? body.options : {};
      const options = {
        refreshMetrics: typeof rawOptions.refreshMetrics === 'boolean' ? rawOptions.refreshMetrics : modeDefaults.refreshMetrics,
        refreshInsights: typeof rawOptions.refreshInsights === 'boolean' ? rawOptions.refreshInsights : modeDefaults.refreshInsights,
        refreshRecommendations: typeof rawOptions.refreshRecommendations === 'boolean' ? rawOptions.refreshRecommendations : modeDefaults.refreshRecommendations,
        mode,
      };

      const out = await service.searchStrategic({
        tenantId,
        question,
        period: body?.period || 'month',
        filters: body?.filters && typeof body.filters === 'object' ? body.filters : {},
        options,
      });

      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em /api/intelligence/search:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar busca estrategica' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/intelligence/operational-state') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const mode = String(body?.mode || 'read').toLowerCase();
      const modeDefaults = mode === 'refresh' ? { refreshMetrics: true } : { refreshMetrics: false };
      const rawOptions = body?.options && typeof body.options === 'object' ? body.options : {};
      const options = {
        refreshMetrics: typeof rawOptions.refreshMetrics === 'boolean' ? rawOptions.refreshMetrics : modeDefaults.refreshMetrics,
        includeEvidence: typeof rawOptions.includeEvidence === 'boolean' ? rawOptions.includeEvidence : false,
        mode,
      };

      const out = await service.getOperationalState({
        tenantId,
        period: body?.period || 'month',
        filters: body?.filters && typeof body.filters === 'object' ? body.filters : {},
        options,
      });

      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em /api/intelligence/operational-state:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estado operacional do tenant' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/intelligence/operational-state') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const mode = String(urlObj.searchParams.get('mode') || 'read').toLowerCase();
      const modeDefaults = mode === 'refresh' ? { refreshMetrics: true } : { refreshMetrics: false };
      const refreshMetricsInput = parseBooleanInput(urlObj.searchParams.get('refreshMetrics'), null);
      const includeEvidenceInput = parseBooleanInput(urlObj.searchParams.get('includeEvidence'), null);

      let filters = {};
      const rawFilters = urlObj.searchParams.get('filters');
      if (rawFilters) {
        try {
          const parsed = JSON.parse(rawFilters);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            filters = parsed;
          }
        } catch (_) {
          filters = {};
        }
      }

      const out = await service.getOperationalState({
        tenantId,
        period: urlObj.searchParams.get('period') || 'month',
        filters,
        options: {
          refreshMetrics: typeof refreshMetricsInput === 'boolean' ? refreshMetricsInput : modeDefaults.refreshMetrics,
          includeEvidence: typeof includeEvidenceInput === 'boolean' ? includeEvidenceInput : false,
          mode,
        },
      });

      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/operational-state:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estado operacional do tenant' });
    }
    return true;
  }

  const goalsHandled = await handleIntelligenceGoalRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      requirePermission,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
    service,
    tenantId,
  });
  if (goalsHandled) return true;

  const analyticsHandled = await handleIntelligenceAnalyticsRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      requirePermission,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
    service,
    tenantId,
  });
  if (analyticsHandled) return true;

  return false;
}

module.exports = {
  handleIntelligenceRoutes,
};
