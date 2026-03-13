async function handleSolutionRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (!pathname.startsWith('/api/solutions/packs')) {
    return false;
  }

  // GET /api/solutions/packs
  if (method === 'GET' && pathname === '/api/solutions/packs') {
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
      const solutions = require('../services/solutions/solutionsTemplateService');
      const items = solutions.listSolutionPacks();
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[Solutions] Erro ao listar packs', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar packs' });
    }
    return true;
  }

  // POST /api/solutions/packs/install
  if (method === 'POST' && pathname === '/api/solutions/packs/install') {
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
      const segment = body && body.segment ? String(body.segment).trim() : '';
      if (!segment) {
        badRequest(res, 'segment é obrigatório');
        return true;
      }

      const solutions = require('../services/solutions/solutionsTemplateService');
      const result = await solutions.installSolutionPack({ tenantId: req.tenantId, segment });
      if (!result.success) {
        sendJson(res, 400, { ok: false, error: result.error || 'install_failed' });
        return true;
      }

      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[Solutions] Erro ao instalar pack', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao instalar pack' });
    }
    return true;
  }

  return false;
}

module.exports = { handleSolutionRoutes };
