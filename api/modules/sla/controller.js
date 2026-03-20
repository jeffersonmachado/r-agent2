'use strict';

function createSlaController({ service, deps }) {
  function ensureReportsPermission(req, res, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, 'reports', action);
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
    async listPolicies(req, res) {
      if (!ensureReportsPermission(req, res, 'read')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.listPolicies(tenantId);
        if (!out.ok) {
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'sla_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, policies: out.policies || [] });
      } catch (err) {
        deps.logger.error('[SLA] Erro ao listar policies:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar policies' });
      }
    },

    async savePolicy(req, res) {
      if (!ensureReportsPermission(req, res, 'update')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.upsertPolicy(tenantId, await deps.parseJsonBody(req));
        if (!out.ok) {
          if (out.kind === 'bad_request') {
            deps.badRequest(res, out.message);
            return;
          }
          deps.sendJson(res, 503, out.payload);
          return;
        }
        deps.sendJson(res, 200, out.payload);
      } catch (err) {
        deps.logger.error('[SLA] Erro ao salvar policy:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar policy' });
      }
    },

    async listBreaches(req, res) {
      if (!ensureReportsPermission(req, res, 'read')) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      try {
        const out = await service.listBreaches(tenantId);
        if (!out.ok) {
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'sla_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, breaches: out.breaches || [] });
      } catch (err) {
        deps.logger.error('[SLA] Erro ao listar breaches:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar breaches' });
      }
    },
  };
}

module.exports = {
  createSlaController,
};
