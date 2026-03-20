'use strict';

function createTaskController({ service, deps }) {
  function ensureConfigPermission(req, res, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, 'config', action);
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

  function requireTenantOrReturn(req, res) {
    return deps.requireTenant(req, res);
  }

  return {
    async list(req, res) {
      if (!ensureConfigPermission(req, res, 'read')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.listTasks(tenantId);
        if (!out.ok) {
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'tasks_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, tasks: out.tasks || [] });
      } catch (err) {
        deps.logger.error('[Tasks] Erro ao listar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tarefas' });
      }
    },

    async create(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.createTask(tenantId, await deps.parseJsonBody(req));
        if (!out.ok) {
          if (out.kind === 'bad_request') {
            deps.badRequest(res, out.message);
            return;
          }
          deps.sendJson(res, 503, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        deps.logger.error('[Tasks] Erro ao criar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar tarefa' });
      }
    },

    async complete(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.completeTask(tenantId, req);
        if (!out.ok) {
          deps.sendJson(res, out.status, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        deps.logger.error('[Tasks] Erro ao completar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao completar tarefa' });
      }
    },

    async reminder(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.scheduleReminder(tenantId, req, await deps.parseJsonBody(req));
        if (!out.ok) {
          deps.sendJson(res, out.status, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        deps.logger.error('[Tasks] Erro ao agendar lembrete:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao agendar lembrete' });
      }
    },
  };
}

module.exports = {
  createTaskController,
};
