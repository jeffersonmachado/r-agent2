async function handleChannelAccountRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody, logger } = deps;

  function isHtmlNavigationRequest() {
    const accept = String(req.headers?.accept || '').toLowerCase();
    const secFetchDest = String(req.headers?.['sec-fetch-dest'] || '').toLowerCase();
    return accept.includes('text/html') || secFetchDest === 'document';
  }

  if (!pathname.startsWith('/channel-accounts')) {
    return false;
  }

  // GET /channel-accounts
  if (method === 'GET' && pathname === '/channel-accounts') {
    // Navegação de página deve ser tratada pelo frontend fallback.
    if (isHtmlNavigationRequest()) {
      return false;
    }

    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const includeConfig = urlObj.searchParams.get('includeConfig') === 'true';
      const { listAccounts } = require('../../services/channelAccountsService');
      const accounts = await listAccounts({ tenantId: req.tenantId, includeConfig });
      sendJson(res, 200, { accounts });
    } catch (err) {
      logger.error('Erro ao listar channel-accounts', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /channel-accounts
  if (method === 'POST' && pathname === '/channel-accounts') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { type, externalId, status, config } = body || {};
      const { createAccount } = require('../../services/channelAccountsService');
      const result = await createAccount({ tenantId: req.tenantId, type, externalId, status, config });
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      sendJson(res, 201, result);
    } catch (err) {
      logger.error('Erro ao criar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /channel-accounts/:id/test — deve vir ANTES do PUT
  if (method === 'POST' && pathname.startsWith('/channel-accounts/') && pathname.endsWith('/test')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length).replace('/test', ''));
      const { testAccountConnection } = require('../../services/channelAccountsService');
      const result = await testAccountConnection({ tenantId: req.tenantId, id, timeoutMs: 8000 });
      if (!result.success) {
        if (result.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found' });
          return true;
        }
        if (result.error === 'missing_config') {
          sendJson(res, 400, { error: 'missing_config', missing: result.missing || [] });
          return true;
        }
        sendJson(res, 502, { error: result.error || 'upstream_error', message: result.message, details: result.details, statusCode: result.statusCode });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao testar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // PUT /channel-accounts/:id
  if (method === 'PUT' && pathname.startsWith('/channel-accounts/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length));
      const body = await parseJsonBody(req);
      const { updateAccount } = require('../../services/channelAccountsService');
      const result = await updateAccount({ tenantId: req.tenantId, id, patch: body || {} });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 400, { error: result.error });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // DELETE /channel-accounts/:id
  if (method === 'DELETE' && pathname.startsWith('/channel-accounts/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/channel-accounts/'.length));
      const { deleteAccount } = require('../../services/channelAccountsService');
      const result = await deleteAccount({ tenantId: req.tenantId, id });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 400, { error: result.error });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover channel-account', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

module.exports = { handleChannelAccountRoutes };
