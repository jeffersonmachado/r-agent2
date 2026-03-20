'use strict';

function createRbacController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function ensurePermission(req, res, resource, action) {
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  return {
    async listRoles(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'agents', 'read')) return;
      try {
        deps.sendJson(res, 200, { roles: service.listRoles() });
      } catch (err) {
        deps.logger.error('Erro ao listar roles:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },

    async createRole(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;
      try {
        const payload = service.parseRolePayload(await deps.parseJsonBody(req));
        const result = service.createRole(payload.role, payload.permissions);
        if (!result.success) {
          deps.sendJson(res, 400, { error: 'invalid_role', message: result.error });
          return;
        }
        deps.sendJson(res, 201, { role: result.role, permissions: result.permissions });
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao criar role:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },

    async listPermissions(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'agents', 'read')) return;
      try {
        deps.sendJson(res, 200, { permissions: service.listPermissions() });
      } catch (err) {
        deps.logger.error('Erro ao listar permissões:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },

    async assignRole(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'agents', 'update')) return;
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return;
      if (!ensureJson(req, res)) return;

      try {
        const payload = service.parseAssignPayload(await deps.parseJsonBody(req));
        if (!payload.agentId || !payload.role) {
          deps.badRequest(res, 'agentId e role são obrigatórios');
          return;
        }

        const target = await service.getAgent(payload.agentId);
        if (!target) {
          deps.sendJson(res, 404, { error: 'agent_not_found' });
          return;
        }

        if (target.tenantId && target.tenantId !== tenantId) {
          deps.sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
          return;
        }

        const result = await service.updateAgent(payload.agentId, { role: payload.role });
        if (!result.success) {
          deps.sendJson(res, 400, { error: 'update_failed', message: result.error });
          return;
        }

        deps.sendJson(res, 200, { agent: result.agent });
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao atribuir role:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    },
  };
}

module.exports = {
  createRbacController,
};
