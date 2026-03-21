'use strict';

const { ensureJsonRequest, ensureRagPermission, isRouteMatch } = require('./ragRouteUtils');

async function handleRagEphemeralRoutes({ req, res, method, pathname, deps }) {
  if (!isRouteMatch(method, pathname, 'POST', '/rag/ephemeral/context')) {
    return false;
  }

  if (!ensureRagPermission({ req, res, deps, permission: 'create' })) return true;
  if (!ensureJsonRequest({ req, res, deps })) return true;

  try {
    const body = await deps.parseJsonBody(req);
    const { requireExecutionId } = require('../../../middleware/requireExecutionId');
    const executionId = requireExecutionId(body, res, deps.badRequest);
    if (!executionId) {
      return true;
    }

    const requestedTenantId = body?.tenantId ? String(body.tenantId).trim() : '';
    const authenticatedTenantId = req.agent?.tenantId ? String(req.agent.tenantId).trim() : '';
    const isSuperAdminUser = deps.isSuperAdmin(req.agent);
    const tenantId = isSuperAdminUser && requestedTenantId
      ? requestedTenantId
      : authenticatedTenantId;

    if (!tenantId) {
      deps.badRequest(res, 'tenantId é obrigatório');
      return true;
    }

    const { upsertEphemeralContext } = require('../../../services/ephemeralRagContextService');
    const result = await upsertEphemeralContext({
      tenantId,
      executionId,
      chunks: Array.isArray(body?.chunks) ? body.chunks : [],
      ttlSeconds: body?.ttlSeconds,
      replace: body?.replace === true,
    });

    deps.sendJson(res, 200, {
      ok: true,
      tenantId,
      executionId,
      ...result,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      deps.badRequest(res, 'JSON inválido no corpo da requisição');
    } else {
      deps.logger.error('Erro ao persistir contexto efêmero RAG:', err);
      deps.sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao persistir contexto efêmero',
      });
    }
  }

  return true;
}

module.exports = {
  handleRagEphemeralRoutes,
};
