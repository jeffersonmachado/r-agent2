'use strict';

const {
  getUrl,
  decodeRouteParam,
  readOptionalQuery,
  readOutcomeFilters,
  withOccSuperAdmin,
  buildOperationalPipelineService,
} = require('./occShared');

async function handleOccOutcomesRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      isSuperAdmin,
      sendJson,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-outcomes$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar outcomes operacionais',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-outcomes$/);
          const tenantId = decodeRouteParam(match, 1);
          const limit = Number(urlObj.searchParams.get('limit') || 120);
          const outcomeFilters = readOutcomeFilters(urlObj.searchParams);

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccOutcomes({
            tenantId,
            limit,
            ...outcomeFilters,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar outcomes operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-outcomes\/signals\/[^/]+$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar outcomes de sinal',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-outcomes\/signals\/([^/]+)$/);
          const tenantId = decodeRouteParam(match, 1);
          const signalId = decodeRouteParam(match, 2);
          const limit = Number(urlObj.searchParams.get('limit') || 120);
          const status = readOptionalQuery(urlObj.searchParams, 'status');

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccOutcomes({
            tenantId,
            signalId,
            sourceType: 'signal',
            sourceId: signalId,
            status,
            limit,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar outcomes por sinal OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-outcomes\/recommendations\/[^/]+$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar outcomes de recomendação',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-outcomes\/recommendations\/([^/]+)$/);
          const tenantId = decodeRouteParam(match, 1);
          const recommendationId = decodeRouteParam(match, 2);
          const limit = Number(urlObj.searchParams.get('limit') || 120);
          const status = readOptionalQuery(urlObj.searchParams, 'status');

          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccOutcomes({
            tenantId,
            recommendationId,
            sourceType: 'recommendation',
            sourceId: recommendationId,
            status,
            limit,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar outcomes por recomendação OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  return false;
}

module.exports = {
  handleOccOutcomesRoutes,
};
