'use strict';

/**
 * DELETE /flows/:id
 * Remove um fluxo da memória e persiste a deleção.
 */
async function handleFlowCrudDeleteRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    sendJson,
    logger,
    flows,
    deleteFlowBestEffort,
    triggerWebhooks,
    emitEvent,
    STRICT_TENANT_MODE,
  } = deps;

  if (method !== 'DELETE' || !pathname.startsWith('/flows/')) {
    return false;
  }

  const id = decodeURIComponent(pathname.slice('/flows/'.length));

  // Auth ANTES da checagem de existência: fail-closed e sem oráculo de
  // existência para chamadores anônimos.
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

  const flow = flows.get(id);
  if (!flow) {
    sendJson(res, 404, { error: 'flow_not_found' });
    return true;
  }

  if (STRICT_TENANT_MODE) {
    if (flow.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return true;
    }
  } else {
    // DEV/compatibilidade: valida tenant se autenticado
    if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return true;
    }
  }

  flows.delete(id);
  await deleteFlowBestEffort(id);

  // Dispara webhooks e WebSocket
  triggerWebhooks(flow.tenantId, 'flow.deleted', {
    flowId: flow.id,
    flowName: flow.name,
    agentId: req.agent?.id,
  }).catch((err) => {
    logger.error('[Webhook] Erro ao disparar webhook para flow.deleted:', err);
  });

  emitEvent('flow.deleted', {
    flowId: flow.id,
    flowName: flow.name,
    agentId: req.agent?.id,
  }, { tenantId: flow.tenantId });

  sendJson(res, 200, { success: true, deletedId: id });
  return true;
}

module.exports = { handleFlowCrudDeleteRoute };
