'use strict';

function createSchedulingSupportController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function requireTenantOrReturn(req, res) {
    return deps.requireTenant(req, res);
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  return {
    async searchUsers(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      deps.sendJson(res, 200, await service.searchUsers(req, tenantId));
    },

    async searchTeams(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      deps.sendJson(res, 200, service.searchTeams(req, tenantId));
    },

    async listPurposes(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      deps.sendJson(res, 200, service.listSchedulePurposes(req, tenantId));
    },

    async listCrmContacts(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      deps.sendJson(res, 200, await service.listCrmContacts(req, tenantId, deps.logger));
    },

    async getMyCalendar(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      const out = service.getMyCalendar(req, tenantId);
      if (!out.ok) {
        deps.sendJson(res, 400, out.payload);
        return;
      }
      deps.sendJson(res, 200, out.payload);
    },

    async getResourceCalendar(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      const out = service.getResourceCalendar(req, tenantId);
      if (!out.ok) {
        deps.badRequest(res, out.message);
        return;
      }
      deps.sendJson(res, 200, out.payload);
    },

    async createBlock(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;
      if (!ensureJson(req, res)) return;

      const out = service.createCalendarBlock(req, tenantId, await deps.parseJsonBody(req));
      if (!out.ok) {
        deps.badRequest(res, out.message);
        return;
      }
      deps.sendJson(res, out.status, out.payload);
    },

    async deleteBlock(req, res) {
      if (!ensureAuth(req, res)) return;
      const tenantId = requireTenantOrReturn(req, res);
      if (!tenantId) return;

      const out = service.deleteCalendarBlock(req, tenantId);
      if (!out.ok) {
        if (out.kind === 'bad_request') {
          deps.badRequest(res, out.message);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
        return;
      }
      deps.sendJson(res, 200, out.payload);
    },
  };
}

module.exports = {
  createSchedulingSupportController,
};
