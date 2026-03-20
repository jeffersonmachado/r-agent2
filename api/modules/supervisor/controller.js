'use strict';

function createSupervisorController({ service, deps }) {
  function ensureReportsRead(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }

    return true;
  }

  function requireTenantOrReturn(req, res) {
    return deps.requireTenant(req, res);
  }

  return {
    async metrics(req, res) {
      if (!ensureReportsRead(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        deps.sendJson(res, 200, await service.getMetrics(req, tenantId));
      } catch (err) {
        deps.logger.error('Erro ao obter métricas de supervisor:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },

    async agentsStatus(req, res) {
      if (!ensureReportsRead(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        deps.sendJson(res, 200, await service.getAgentsStatus(tenantId));
      } catch (err) {
        deps.logger.error('Erro ao obter status de agentes:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },

    async queuesStatus(req, res) {
      if (!ensureReportsRead(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        deps.sendJson(res, 200, await service.getQueuesStatus(tenantId));
      } catch (err) {
        deps.logger.error('Erro ao obter status de filas:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },
  };
}

module.exports = {
  createSupervisorController,
};
