/**
 * Handler para rotas de leitura de fluxos
 * GET /flows, GET /flows/:id
 */

async function handleFlowCrudReadRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    sendJson,
    flows,
    STRICT_TENANT_MODE,
  } = deps;

  // GET /flows
  if (method === 'GET' && pathname === '/flows') {
    const authResult = requireAuth(req);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const envFilter = urlObj.searchParams.get('environment');
    if (STRICT_TENANT_MODE) {
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const tenantFlows = Array.from(flows.values()).filter((flow) => flow.tenantId === tenantId);
      const filtered = envFilter
        ? tenantFlows.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
        : tenantFlows;
      sendJson(res, 200, filtered);
    } else {
      if (authResult.valid && req.tenantId) {
        const tenantFlows = Array.from(flows.values()).filter((flow) => flow.tenantId === req.tenantId);
        const filtered = envFilter
          ? tenantFlows.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
          : tenantFlows;
        sendJson(res, 200, filtered);
      } else {
        const all = Array.from(flows.values());
        const filtered = envFilter
          ? all.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
          : all;
        sendJson(res, 200, filtered);
      }
    }
    return true;
  }

  // GET /flows/:id
  if (method === 'GET' && pathname.startsWith('/flows/') && !pathname.endsWith('/environment')) {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    let flow = flows.get(id);

    // Best-effort fallback no DB quando cache em memoria nao tiver o fluxo.
    if (!flow) {
      try {
        const { getSequelize } = require('../../db/sequelize');
        const sequelize = getSequelize();
        if (sequelize) {
          const { Flow } = require('../../db/models');
          const FlowModel = Flow();
          const row = await FlowModel.findByPk(id);
          if (row) {
            const data = row.data && typeof row.data === 'object' ? row.data : {};
            const flowObj = { ...data, id: row.id };
            if (row.tenant_key && !flowObj.tenantId) flowObj.tenantId = row.tenant_key;
            if (row.name && !flowObj.name) flowObj.name = row.name;
            flows.set(row.id, flowObj);
            flow = flowObj;
          }
        }
      } catch (_) {
        // preserve comportamento legado de retornar 404 em caso de falha no fallback
      }
    }

    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return true;
    }

    const authResult = requireAuth(req);
    if (STRICT_TENANT_MODE) {
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

    sendJson(res, 200, flow);
    return true;
  }

  return false;
}

module.exports = {
  handleFlowCrudReadRoutes,
};
