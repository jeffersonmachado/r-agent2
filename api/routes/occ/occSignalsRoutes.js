'use strict';

const {
  getUrl,
  decodeRouteParam,
  readOptionalQuery,
  withOccSuperAdmin,
  buildOperationalPipelineService,
} = require('./occShared');

async function handleOccSignalsRoutes(context = {}) {
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

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode acessar sinais operacionais',
      handler: async () => {
        try {
          const urlObj = getUrl(req);
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals$/);
          const tenantId = decodeRouteParam(match, 1);
          const activeOnly = urlObj.searchParams.get('activeOnly') === 'true';
          const limit = Number(urlObj.searchParams.get('limit') || 200);
          const contactId = readOptionalQuery(urlObj.searchParams, 'contactId')
            || readOptionalQuery(urlObj.searchParams, 'contact_id');
          const status = readOptionalQuery(urlObj.searchParams, 'status');
          const severity = readOptionalQuery(urlObj.searchParams, 'severity');
          const type = readOptionalQuery(urlObj.searchParams, 'type');
          const includeOutcomes = urlObj.searchParams.get('includeOutcomes') === 'true';
          const from = readOptionalQuery(urlObj.searchParams, 'from')
            || readOptionalQuery(urlObj.searchParams, 'dateFrom')
            || readOptionalQuery(urlObj.searchParams, 'startDate');
          const to = readOptionalQuery(urlObj.searchParams, 'to')
            || readOptionalQuery(urlObj.searchParams, 'dateTo')
            || readOptionalQuery(urlObj.searchParams, 'endDate');
          const pipeline = buildOperationalPipelineService();
          const out = await pipeline.listOccSignals({
            tenantId,
            activeOnly,
            limit,
            contactId,
            status,
            severity,
            type,
            from,
            to,
            ...(includeOutcomes ? { includeOutcomes: true } : {}),
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao listar sinais operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals\/generate$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode gerar sinais operacionais',
      handler: async () => {
        try {
          const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals\/generate$/);
          const tenantId = decodeRouteParam(match, 1);
          const service = buildOperationalPipelineService();
          const contactId = body?.contactId ? String(body.contactId).trim() : null;
          const out = contactId
            ? await service.generateContactSignals({ tenantId, contactId })
            : await service.generateTenantSignals({ tenantId });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao gerar sinais operacionais OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals\/[^/]+\/status$/)) {
    await withOccSuperAdmin({
      req,
      res,
      requireAuth,
      isSuperAdmin,
      sendJson,
      forbiddenMessage: 'Apenas Super Admin pode atualizar sinais operacionais',
      handler: async () => {
        try {
          const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
          const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals\/([^/]+)\/status$/);
          const tenantId = decodeRouteParam(match, 1);
          const signalId = decodeRouteParam(match, 2);
          const service = buildOperationalPipelineService();
          const out = await service.updateSignalStatus({
            tenantId,
            signalId,
            status: body?.status,
            actorId: req.agent?.id || req.agent?.username || null,
          });
          sendJson(res, out.ok ? 200 : 400, out);
        } catch (err) {
          logger.error('Erro ao atualizar status de sinal operacional OCC:', err);
          sendJson(res, 500, { error: 'internal_error' });
        }
      },
    });
    return true;
  }

  return false;
}

module.exports = {
  handleOccSignalsRoutes,
};
