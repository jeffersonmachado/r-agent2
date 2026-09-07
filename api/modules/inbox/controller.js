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
    const permResult = deps.requirePermission(req, 'inbox', action);
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

  async function respondServiceResult(res, out) {
    if (!out.ok) {
      if (out.kind === 'bad_request') {
        deps.badRequest(res, out.message);
        return;
      }
      deps.sendJson(res, out.status, out.payload);
      return;
    }
    deps.sendJson(res, out.status, out.payload);
  }

  async function runWithBody(req, res, handler, logMessage) {
    if (!ensureJson(req, res)) return;
    try {
      const out = await handler(await deps.parseJsonBody(req));
      await respondServiceResult(res, out);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      deps.logger.error(logMessage, err);
      deps.sendJson(res, 500, { error: 'internal_error' });
    }
  }

  return {
    async list(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'read')) return;
      try {
        const out = await service.listConversations(req);
        await respondServiceResult(res, out);
      } catch (err) {
        deps.logger.error('Erro ao listar conversas (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },

    async get(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'read')) return;
      try {
        const out = await service.getConversation(req);
        await respondServiceResult(res, out);
      } catch (err) {
        deps.logger.error('Erro ao obter conversa (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },

    async intelligence(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'read')) return;
      try {
        const out = await service.getConversationIntelligence(req);
        await respondServiceResult(res, out);
      } catch (err) {
        deps.logger.error('Erro ao obter inteligencia da conversa (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    },

    async reply(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'reply')) return;
      await runWithBody(req, res, (body) => service.reply(req, body), 'Erro ao responder conversa (inbox):');
    },

    async assign(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'assign')) return;
      await runWithBody(req, res, (body) => service.assignConversation(req, body), 'Erro ao atribuir conversa (inbox):');
    },

    async transfer(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'transfer')) return;
      await runWithBody(req, res, (body) => service.transferConversation(req, body), 'Erro ao transferir conversa (inbox):');
    },

    async setStatus(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'update')) return;
      await runWithBody(req, res, (body) => service.setConversationStatus(req, body), 'Erro ao atualizar status da conversa (inbox):');
    },

    async notes(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'update')) return;
      await runWithBody(req, res, (body) => service.addNote(req, body), 'Erro ao adicionar nota (inbox):');
    },

    async createCase(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'create')) return;
      await runWithBody(req, res, (body) => service.createCase(req, body), 'Erro ao criar case a partir da conversa (inbox):');
    },
  };
}

module.exports = {
  createInboxController,
};
