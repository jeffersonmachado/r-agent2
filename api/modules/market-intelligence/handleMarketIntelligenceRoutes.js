'use strict';

const tenantService = require('../../services/tenantService');
const { getMarketKnowledgeService } = require('../../core/market-intelligence/MarketKnowledgeService');
const aiControlPlaneStatus = require('../../services/aiControlPlaneStatus');

function parseMetricKeys(searchParams) {
  const multi = searchParams.getAll('metric_key').map((item) => String(item).trim()).filter(Boolean);
  if (multi.length > 0) return multi;

  return String(searchParams.get('metric_keys') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveTenantKey(req, res, deps, searchParams) {
  const tenantId = deps.requireTenant(req, res);
  if (!tenantId) return { handled: true, tenantKey: null };

  const requestedTenantKey = String(searchParams.get('tenant_key') || tenantId);
  if (requestedTenantKey !== String(tenantId)) {
    deps.sendJson(res, 403, {
      error: 'forbidden',
      message: 'tenant_key deve corresponder ao tenant autenticado',
    });
    return { handled: true, tenantKey: null };
  }

  return { handled: false, tenantKey: requestedTenantKey };
}

async function handleMarketIntelligenceRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
  } = deps;

  if (!pathname.startsWith('/api/market/')) return false;

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permResult = requirePermission(req, 'analytics', 'read');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const searchParams = urlObj.searchParams;
  const tenantResult = resolveTenantKey(req, res, { requireTenant, sendJson }, searchParams);
  if (tenantResult.handled) return true;

  const tenantKey = tenantResult.tenantKey;
  const metricKeys = parseMetricKeys(searchParams);
  const tenantContext = tenantService.getTenantContext(String(tenantKey)) || {};
  const vertical = String(searchParams.get('vertical') || tenantContext?.ramo_atividade || 'global');
  const problemType = searchParams.get('problem_type') || null;
  const service = getMarketKnowledgeService();

  try {
    if (method === 'GET' && pathname === '/api/market/benchmarks') {
      const out = await service.getBenchmarks(tenantKey, {
        metricKeys,
        vertical,
        region: searchParams.get('region') || undefined,
      });
      aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', 'HEALTHY');
      sendJson(res, 200, out);
      return true;
    }

    if (method === 'GET' && pathname === '/api/market/patterns') {
      const out = await service.getMarketPatterns(vertical, {
        patternType: searchParams.get('pattern_type') || undefined,
        limit: searchParams.get('limit') || undefined,
      });
      aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', 'HEALTHY');
      sendJson(res, 200, out);
      return true;
    }

    if (method === 'GET' && pathname === '/api/market/predictions') {
      const out = await service.getPredictions(tenantKey, {
        metricKeys,
        vertical,
        region: searchParams.get('region') || undefined,
        predictionType: searchParams.get('prediction_type') || undefined,
        predictionWindow: searchParams.get('prediction_window') || undefined,
        forceRefresh: String(searchParams.get('refresh') || 'false') === 'true',
      });
      aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', 'HEALTHY');
      sendJson(res, 200, out);
      return true;
    }

    if (method === 'GET' && pathname === '/api/market/playbooks') {
      const out = await service.getMarketPlaybooks(vertical, {
        problemType,
        limit: searchParams.get('limit') || undefined,
      });
      aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', 'HEALTHY');
      sendJson(res, 200, out);
      return true;
    }
  } catch (err) {
    aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', 'DEGRADED');
    logger.error('[MarketIntelligenceRoutes] erro ao processar rota de market intelligence', err);
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Erro ao processar camada de market intelligence',
    });
    return true;
  }

  return false;
}

module.exports = {
  handleMarketIntelligenceRoutes,
};
