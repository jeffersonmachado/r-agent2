'use strict';

async function handleFlowDelete({
  id,
  req,
  res,
  flows,
  strictTenantMode = false,
  requireAuth,
  requireTenant,
  sendJson,
  triggerWebhooks,
  emitEvent,
  deleteFlowBestEffort,
}) {
  const flow = flows.get(id);
  if (!flow) {
    sendJson(res, 404, { error: 'flow_not_found' });
    return true;
  }

  const authResult = requireAuth(req);
  if (strictTenantMode) {
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (flow.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
      return true;
    }
  } else if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
    return true;
  }

  flows.delete(id);
  deleteFlowBestEffort(id);

  triggerWebhooks(flow.tenantId, 'flow.deleted', {
    flowId: flow.id,
    flowName: flow.name,
    agentId: req.agent?.id,
  }).catch(() => {});

  emitEvent('flow.deleted', {
    flowId: flow.id,
    flowName: flow.name,
    agentId: req.agent?.id,
  }, { tenantId: flow.tenantId });

  sendJson(res, 200, { success: true, deletedId: id });
  return true;
}

module.exports = { handleFlowDelete };
