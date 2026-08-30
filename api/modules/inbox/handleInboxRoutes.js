'use strict';

// Handler legado (ticket-based). Mantido para compatibilidade com testes e
// callers antigos; usa a implementação ticket-based preservada em
// ./legacyTicketService. O inbox novo (ChannelConversation-based) vive em
// ./service + ./controller + ./routes.
const { createInboxService } = require('./legacyTicketService');

async function handleInboxRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;

  if (!pathname.startsWith('/inbox/')) {
    return false;
  }

  const service = createInboxService(deps);

  function unauthorized(message) {
    deps.sendJson(res, 401, { error: 'unauthorized', message });
  }

  function forbidden(message) {
    deps.sendJson(res, 403, { error: 'forbidden', message });
  }

  function ensureAuth() {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      unauthorized(authResult.error);
      return false;
    }
    return true;
  }

  function ensurePermission(action) {
    const permResult = deps.requirePermission(req, 'tickets', action);
    if (!permResult.allowed) {
      forbidden(permResult.error);
      return false;
    }
    return true;
  }

  function ensureJson() {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  if (method === 'GET' && pathname === '/inbox/conversations') {
    if (!ensureAuth() || !ensurePermission('read')) return true;
    deps.sendJson(res, 200, service.listConversations(req));
    return true;
  }

  if (
    method === 'GET' &&
    pathname.startsWith('/inbox/conversations/') &&
    !pathname.endsWith('/assign') &&
    !pathname.endsWith('/transfer') &&
    !pathname.endsWith('/notes')
  ) {
    if (!ensureAuth() || !ensurePermission('read')) return true;
    const out = service.getConversation({
      ...req,
      params: { ...(req.params || {}), conversationId: decodeURIComponent(pathname.slice('/inbox/conversations/'.length)) },
    });
    if (!out.ok) {
      deps.sendJson(res, out.status, out.payload);
      return true;
    }
    deps.sendJson(res, 200, out.ticket);
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/assign')) {
    if (!ensureAuth() || !ensurePermission('assign') || !ensureJson()) return true;
    try {
      const out = await service.assignConversation({
        ...req,
        params: {
          ...(req.params || {}),
          conversationId: decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/assign'.length)),
        },
      }, await deps.parseJsonBody(req));
      if (!out.ok) {
        deps.sendJson(res, out.status, out.payload);
        return true;
      }
      deps.sendJson(res, out.status, out.payload);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        deps.logger.error('Erro ao atribuir ticket (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/transfer')) {
    if (!ensureAuth() || !ensurePermission('update') || !ensureJson()) return true;
    try {
      const out = await service.transferConversation({
        ...req,
        params: {
          ...(req.params || {}),
          conversationId: decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/transfer'.length)),
        },
      }, await deps.parseJsonBody(req));
      if (!out.ok) {
        if (out.kind === 'bad_request') {
          deps.badRequest(res, out.message);
          return true;
        }
        deps.sendJson(res, out.status, out.payload);
        return true;
      }
      deps.sendJson(res, out.status, out.payload);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        deps.logger.error('Erro ao transferir ticket (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/notes')) {
    if (!ensureAuth() || !ensurePermission('update') || !ensureJson()) return true;
    try {
      const out = await service.addNote({
        ...req,
        params: {
          ...(req.params || {}),
          conversationId: decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/notes'.length)),
        },
      }, await deps.parseJsonBody(req));
      if (!out.ok) {
        if (out.kind === 'bad_request') {
          deps.badRequest(res, out.message);
          return true;
        }
        deps.sendJson(res, out.status, out.payload);
        return true;
      }
      deps.sendJson(res, out.status, out.payload);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        deps.logger.error('Erro ao adicionar nota (inbox):', err);
        deps.sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = {
  handleInboxRoutes,
};
