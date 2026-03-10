'use strict';

const {
  getUrl,
  decodeRouteParam,
  readOptionalQuery,
  withOccSuperAdmin,
  buildOperationalPipelineService,
} = require('./occShared');

async function handleOccRecommendationsRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      isSuperAdmin,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-recommendations$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar recomendações operacionais',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-recommendations$/);
          const tenantId = decodeRouteParam(match, 1);
          const limit = Number(urlObj.searchParams.get('limit') || 200);
          const contactId = readOptionalQuery(urlObj.searchParams, 'contactId')
            || readOptionalQuery(urlObj.searchParams, 'contact_id');
          const status = readOptionalQuery(urlObj.searchParams, 'status');
          const priority = readOptionalQuery(urlObj.searchParams, 'priority');
          const type = readOptionalQuery(urlObj.searchParams, 'type');
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');
          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccRecommendations({
            tenantId,
            limit,
            contactId,
            status,
            priority,
            type,
            from,
            to,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar recomendações operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-recommendations\/generate$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode gerar recomendações operacionais',
      handler: async () => {
        try {
          const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-recommendations\/generate$/);
          const tenantId = decodeRouteParam(match, 1);
          const service = buildOperationalPipelineService();
          const contactId = body?.contactId ? String(body.contactId).trim() : null;
          const out = contactId
            ? await service.generateContactRecommendations({ tenantId, contactId, includeSignalGeneration: true })
            : await service.generateTenantRecommendations({ tenantId, includeSignalGeneration: true });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao gerar recomendações operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-recommendations\/[^/]+\/status$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode atualizar recomendações operacionais',
      handler: async () => {
        try {
          const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-recommendations\/([^/]+)\/status$/);
          const tenantId = decodeRouteParam(match, 1);
          const recommendationId = decodeRouteParam(match, 2);
          const service = buildOperationalPipelineService();
          const out = await service.updateRecommendationStatus({
            tenantId,
            recommendationId,
            status: body?.status,
            actorId: req.agent?.id || req.agent?.username || null,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao atualizar status de recomendação operacional OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  return false;
}

module.exports = {
  handleOccRecommendationsRoutes,
};
