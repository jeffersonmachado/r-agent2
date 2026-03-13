module.exports = { handleQuickRepliesRoutes };

async function handleQuickRepliesRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    listQuickReplies,
    getQuickReply,
    createQuickReply,
    updateQuickReply,
    deleteQuickReply,
    incrementUsage,
    searchByContext,
  } = deps;

  // GET /quick-replies - Lista respostas rápidas
  if (method === 'GET' && pathname === '/quick-replies') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      tenantId,
      category: urlObj.searchParams.get('category') || undefined,
      tag: urlObj.searchParams.get('tag') || undefined,
      activeOnly: urlObj.searchParams.get('activeOnly') !== 'false',
      search: urlObj.searchParams.get('search') || undefined,
    };

    const replies = listQuickReplies(filters);
    sendJson(res, 200, { quickReplies: replies });
    return true;
  }

  // GET /quick-replies/categories - Lista categorias
  if (method === 'GET' && pathname === '/quick-replies/categories') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const categories = Array.from(
      new Set(listQuickReplies({ tenantId, activeOnly: false }).map(r => r.category).filter(Boolean))
    ).sort();
    sendJson(res, 200, { categories });
    return true;
  }

  // GET /quick-replies/tags - Lista tags
  if (method === 'GET' && pathname === '/quick-replies/tags') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const tags = Array.from(
      new Set((listQuickReplies({ tenantId, activeOnly: false }).flatMap(r => Array.isArray(r.tags) ? r.tags : [])).filter(Boolean))
    ).sort();
    sendJson(res, 200, { tags });
    return true;
  }

  // POST /quick-replies/search - Busca por contexto
  if (method === 'POST' && pathname === '/quick-replies/search') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { context, limit = 5 } = body || {};

      if (!context || typeof context !== 'string') {
        badRequest(res, 'Campo "context" é obrigatório e deve ser uma string');
        return true;
      }

      const replies = searchByContext(context, tenantId, limit);
      sendJson(res, 200, { quickReplies: replies });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao buscar respostas rápidas:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // GET /quick-replies/:id - Obtém resposta rápida específica
  if (method === 'GET' && pathname.startsWith('/quick-replies/') && 
      pathname !== '/quick-replies/categories' && pathname !== '/quick-replies/tags') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
    const reply = getQuickReply(id);
    
    if (!reply || reply.tenantId !== tenantId) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return true;
    }

    sendJson(res, 200, { quickReply: reply });
    return true;
  }

  // POST /quick-replies - Cria resposta rápida
  if (method === 'POST' && pathname === '/quick-replies') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const permResult = requirePermission(req, 'quick_replies', 'create');
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
      const result = createQuickReply({
        ...body,
        tenantId,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_create',
        resource: 'quick_reply',
        resourceId: result.quickReply.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar resposta rápida:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // PUT /quick-replies/:id - Atualiza resposta rápida
  if (method === 'PUT' && pathname.startsWith('/quick-replies/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const permResult = requirePermission(req, 'quick_replies', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
      const existing = getQuickReply(id);
      if (!existing || existing.tenantId !== tenantId) {
        sendJson(res, 404, { error: 'quick_reply_not_found' });
        return true;
      }

      const body = await parseJsonBody(req);
      const updates = body && typeof body === 'object' ? { ...body } : {};
      delete updates.tenantId;
      const result = updateQuickReply(id, updates);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_update',
        resource: 'quick_reply',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar resposta rápida:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /quick-replies/:id - Remove resposta rápida
  if (method === 'DELETE' && pathname.startsWith('/quick-replies/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const permResult = requirePermission(req, 'quick_replies', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length));
    const existing = getQuickReply(id);
    if (!existing || existing.tenantId !== tenantId) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return true;
    }
    const result = deleteQuickReply(id);

    if (!result.success) {
      badRequest(res, result.error);
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'quick_reply_delete',
      resource: 'quick_reply',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /quick-replies/:id/use - Incrementa contador de uso
  if (method === 'POST' && pathname.startsWith('/quick-replies/') && pathname.endsWith('/use')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const id = decodeURIComponent(pathname.slice('/quick-replies/'.length, -'/use'.length));
    const existing = getQuickReply(id);
    if (!existing || existing.tenantId !== tenantId) {
      sendJson(res, 404, { error: 'quick_reply_not_found' });
      return true;
    }
    incrementUsage(id);
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
