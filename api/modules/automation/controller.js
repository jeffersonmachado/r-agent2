'use strict';

function createAutomationController({ service, deps }) {
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

  function requireTenantOrReturn(req, res) {
    return deps.requireTenant(req, res);
  }

  return {
    async list(req, res) {
      if (!ensureConfigPermission(req, res, 'read')) return;

      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.listAutomations(tenantId);
        if (!out.ok) {
          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: out.error || 'automations_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, { ok: true, automations: out.automations || [] });
      } catch (err) {
        deps.logger.error('[Automations] Erro ao listar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar automações' });
      }
    },

    async create(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;

      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }

      try {
        const payload = service.parseCreatePayload(await deps.parseJsonBody(req));
        const validation = service.validateCreatePayload(payload);
        if (!validation.valid) {
          deps.badRequest(res, validation.message);
          return;
        }

        const out = await service.saveAutomation(tenantId, payload);
        if (!out.ok) {
          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: out.error || 'automations_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, { ok: true, automation: out.automation });
      } catch (err) {
        deps.logger.error('[Automations] Erro ao salvar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar automação' });
      }
    },

    async publish(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;

      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.publishAutomation(tenantId, String(req.params.automationId));
        if (!out.ok) {
          if (out.error === 'not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Automação não encontrada' });
            return;
          }

          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: out.error || 'automations_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, { ok: true, automation: out.automation });
      } catch (err) {
        deps.logger.error('[Automations] Erro ao publicar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao publicar automação' });
      }
    },

    async run(req, res) {
      if (!ensureConfigPermission(req, res, 'update')) return;

      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.runAutomation(tenantId, String(req.params.automationId));
        if (!out.ok) {
          if (out.error === 'not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Automação não encontrada' });
            return;
          }

          deps.sendJson(res, 503, {
            error: 'service_unavailable',
            message: out.error || 'automations_unavailable',
          });
          return;
        }

        deps.sendJson(res, 200, { ok: true, automation: out.automation, run: out.run });
      } catch (err) {
        deps.logger.error('[Automations] Erro ao executar:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar automação' });
      }
    },
  };
}

module.exports = {
  createAutomationController,
};
