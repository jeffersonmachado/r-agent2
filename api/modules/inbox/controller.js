'use strict';

function createInboxController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function ensurePermission(req, res, action) {
    const permResult = deps.requirePermission(req, 'tickets', action);
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
    async list(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'read')) return;
      const out = service.listConversations(req);
      deps.sendJson(res, 200, out);
    },

    async get(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'read')) return;
      const out = service.getConversation(req);
      if (!out.ok) {
        deps.sendJson(res, out.status, out.payload);
        return;
      }
      deps.sendJson(res, 200, out.ticket);
    },

    async assign(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'assign')) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.assignConversation(req, await deps.parseJsonBody(req));
        if (!out.ok) {
          deps.sendJson(res, out.status, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao atribuir ticket (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },

    async transfer(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.transferConversation(req, await deps.parseJsonBody(req));
        if (!out.ok) {
          if (out.kind === 'bad_request') {
            deps.badRequest(res, out.message);
            return;
          }
          deps.sendJson(res, out.status, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao transferir ticket (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },

    async notes(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'update')) return;
      if (!ensureJson(req, res)) return;

      try {
        const out = await service.addNote(req, await deps.parseJsonBody(req));
        if (!out.ok) {
          if (out.kind === 'bad_request') {
            deps.badRequest(res, out.message);
            return;
          }
          deps.sendJson(res, out.status, out.payload);
          return;
        }
        deps.sendJson(res, out.status, out.payload);
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao adicionar nota (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },
  };
}

module.exports = {
  createInboxController,
};
