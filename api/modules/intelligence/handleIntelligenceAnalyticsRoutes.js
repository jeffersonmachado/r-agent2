'use strict';

async function handleIntelligenceAnalyticsRoutes(ctx) {
  const { req, res, method, pathname, deps, service, tenantId } = ctx;
  const {
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

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

  // Product Metrics da camada de decisão (aceite/outcome/automação).
  if (method === 'GET' && pathname === '/api/intelligence/recommendations/stats') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const out = await service.getRecommendationStats({
        tenantId,
        period: urlObj.searchParams.get('period') || 'month',
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/recommendations/stats:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao computar metricas de recomendacoes' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/intelligence/recommendations/')) {
    const tail = pathname.slice('/api/intelligence/recommendations/'.length);
    const segments = tail.split('/').filter(Boolean);

    // Batch "Aprovar todas" (autonomyLevel=approve): checado antes do parsing
    // de :id/apply para que 'apply-all' não vire recommendationId.
    if (segments.length === 1 && segments[0] === 'apply-all') {
      const permResult = requirePermission(req, 'analytics', 'write');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }

      try {
        const body = hasJsonContentType(req) ? await parseJsonBody(req) : {};
        const actor = req.agent?.username || req.agent?.id || null;
        const out = await service.applyAllOpenRecommendations({
          tenantId,
          actor,
          limit: body?.limit != null ? Number(body.limit) : 50,
        });
        sendJson(res, 200, out);
      } catch (err) {
        logger.error('[IntelligenceRoutes] Erro em POST /api/intelligence/recommendations/apply-all:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao aplicar recomendacoes em lote' });
      }
      return true;
    }

    const recommendationId = segments[0] ? decodeURIComponent(segments[0]) : '';
    const action = segments.length === 2 ? decodeURIComponent(segments[1]) : null;
    if (!recommendationId || !['apply', 'dismiss', 'outcome'].includes(action)) {
      return false;
    }

    const permResult = requirePermission(req, 'analytics', 'write');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req) : {};
      const actor = req.agent?.username || req.agent?.id || null;

      let out;
      if (action === 'apply') {
        out = await service.applyRecommendation({ tenantId, recommendationId, actor });
      } else if (action === 'dismiss') {
        out = await service.dismissRecommendation({
          tenantId,
          recommendationId,
          actor,
          reason: body?.reason,
        });
      } else {
        out = await service.evaluateRecommendationOutcome({ tenantId, recommendationId });
      }
      sendJson(res, 200, out);
    } catch (err) {
      if (err && err.statusCode) {
        sendJson(res, err.statusCode, { error: err.code || 'recommendation_error' });
        return true;
      }
      logger.error(`[IntelligenceRoutes] Erro em POST /api/intelligence/recommendations/:id/${action}:`, err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao processar recomendacao' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleIntelligenceAnalyticsRoutes,
};
