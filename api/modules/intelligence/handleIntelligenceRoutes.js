'use strict';

const { getTenantIntelligenceService } = require('../../core/tenant-intelligence/TenantIntelligenceService');

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

  if (method === 'GET' && pathname === '/api/intelligence/goals') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const limit = urlObj.searchParams.get('limit');
      const out = await service.listGoals({
        tenantId,
        status: status || null,
        includeComputed: true,
        limit: limit != null ? Number(limit) : 100,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/goals:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar metas' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/intelligence/goals') {
    const permResult = requirePermission(req, 'config', 'update');
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
      const out = await service.createGoal({ tenantId, payload: body || {} });
      sendJson(res, 201, { ok: true, ...out });
    } catch (err) {
      if (String(err?.message || '').includes('required')) {
        badRequest(res, err.message);
        return true;
      }
      logger.error('[IntelligenceRoutes] Erro em POST /api/intelligence/goals:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar meta' });
    }
    return true;
  }

  if (method === 'PUT' && pathname.startsWith('/api/intelligence/goals/')) {
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const goalId = decodeURIComponent(pathname.slice('/api/intelligence/goals/'.length));
      if (!goalId) {
        badRequest(res, 'goalId e obrigatorio');
        return true;
      }

      const body = await parseJsonBody(req);
      const out = await service.updateGoal({ tenantId, goalId, updates: body || {} });

      if (!out.ok) {
        sendJson(res, 404, { error: out.error || 'goal_not_found', message: 'Meta nao encontrada' });
        return true;
      }

      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em PUT /api/intelligence/goals/:id:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar meta' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/intelligence/metrics/snapshots') {
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
      const out = await service.collectMetricSnapshots({
        tenantId,
        period: body?.period || 'month',
        filters: body?.filters && typeof body.filters === 'object' ? body.filters : {},
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em POST /api/intelligence/metrics/snapshots:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao coletar snapshots' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/intelligence/insights') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const limit = urlObj.searchParams.get('limit');
      const out = await service.listInsights({
        tenantId,
        status: status || null,
        limit: limit != null ? Number(limit) : 100,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/insights:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar insights' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/intelligence/insights/') && pathname.endsWith('/evidence')) {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const insightId = decodeURIComponent(pathname.slice('/api/intelligence/insights/'.length).replace('/evidence', ''));
      if (!insightId) {
        badRequest(res, 'insightId e obrigatorio');
        return true;
      }
      const out = await service.listEvidenceByInsight({ tenantId, insightId });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/insights/:id/evidence:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar evidencias' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/intelligence/recommendations') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const limit = urlObj.searchParams.get('limit');
      const out = await service.listRecommendations({
        tenantId,
        status: status || null,
        limit: limit != null ? Number(limit) : 100,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/recommendations:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar recomendacoes' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleIntelligenceRoutes,
};
