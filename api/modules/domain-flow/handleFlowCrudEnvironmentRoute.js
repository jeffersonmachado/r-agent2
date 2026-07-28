/**
 * Handler para atualização de environment de fluxo
 * PUT /flows/:id/environment
 */

async function handleFlowCrudEnvironmentRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    flows,
    persistFlowBestEffort,
    STRICT_TENANT_MODE,
  } = deps;

  if (!(method === 'PUT' && pathname.startsWith('/flows/') && pathname.endsWith('/environment'))) {
    return false;
  }

  const id = decodeURIComponent(pathname.slice('/flows/'.length).replace(/\/environment$/, ''));
  if (!id) {
    badRequest(res, 'ID do fluxo é obrigatório');
    return true;
  }
  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const body = await parseJsonBody(req);

    // Auth ANTES de validação de negócio e de existência: fail-closed e sem
    // oráculo de existência (anônimo não distingue 404 de fluxo inexistente).
    const authResult = requireAuth(req);
    let tenantId = null;
    if (STRICT_TENANT_MODE) {
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }
      tenantId = requireTenant(req, res);
      if (!tenantId) return true;
    }

    const env = body && body.environment ? String(body.environment).trim() : '';
    if (!env || !['dev', 'stage', 'prod'].includes(env)) {
      badRequest(res, 'Campo "environment" inválido. Use: dev|stage|prod');
      return true;
    }

    const existingFlow = flows.get(id);
    if (!existingFlow) {
      sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${id}" não encontrado` });
      return true;
    }

    if (STRICT_TENANT_MODE) {
      if (existingFlow.tenantId !== tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return true;
      }
    } else if (authResult.valid && req.tenantId && existingFlow.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return true;
    }

    const next = { ...existingFlow };
    next.metadata = next.metadata && typeof next.metadata === 'object' ? { ...next.metadata } : {};
    next.metadata.environment = env;
    flows.set(id, next);
    persistFlowBestEffort(next);
    sendJson(res, 200, { ok: true, flow: next });
  } catch (err) {
    logger.error('[Flows] Erro ao atualizar environment', err);
    sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar environment' });
  }

  return true;
}

module.exports = {
  handleFlowCrudEnvironmentRoute,
};
