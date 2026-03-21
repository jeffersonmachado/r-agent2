module.exports = { handleAiSuggestionRoutes };

async function handleAiSuggestionRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    isSuperAdmin,
    suggestResponse,
    rewriteMessage,
    rewriteMultipleMessages,
  } = deps;

  if (method === 'POST' && pathname === '/ai/suggest-response') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { userMessage, conversationHistory, ticketId, tenantId } = body || {};

      if (!userMessage || typeof userMessage !== 'string') {
        badRequest(res, 'Campo "userMessage" é obrigatório e deve ser uma string');
        return true;
      }

      const isSuperAdminUser = isSuperAdmin(req.agent);
      const effectiveTenantId = (req.agent?.tenantId && String(req.agent.tenantId).trim())
        ? String(req.agent.tenantId).trim()
        : (isSuperAdminUser && tenantId ? String(tenantId).trim() : null);
      if (!effectiveTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const result = await suggestResponse({
        userMessage,
        conversationHistory: conversationHistory || [],
        ticketId,
        tenantId: effectiveTenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao sugerir resposta:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao gerar sugestões',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/ai/rewrite-message') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { message, tone, context, tenantId } = body || {};

      if (!message || typeof message !== 'string') {
        badRequest(res, 'Campo "message" é obrigatório e deve ser uma string');
        return true;
      }

      const isSuperAdminUser = isSuperAdmin(req.agent);
      const effectiveTenantId = (req.agent?.tenantId && String(req.agent.tenantId).trim())
        ? String(req.agent.tenantId).trim()
        : (isSuperAdminUser && tenantId ? String(tenantId).trim() : null);
      if (!effectiveTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const result = await rewriteMessage({
        message,
        tone: tone || 'professional',
        context,
        tenantId: effectiveTenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reescrever mensagem:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao reescrever mensagem',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/ai/rewrite-multiple') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { messages, tone, tenantId } = body || {};

      if (!Array.isArray(messages) || messages.length === 0) {
        badRequest(res, 'Campo "messages" é obrigatório e deve ser um array não vazio');
        return true;
      }

      const isSuperAdminUser = isSuperAdmin(req.agent);
      const effectiveTenantId = (req.agent?.tenantId && String(req.agent.tenantId).trim())
        ? String(req.agent.tenantId).trim()
        : (isSuperAdminUser && tenantId ? String(tenantId).trim() : null);
      if (!effectiveTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const result = await rewriteMultipleMessages({
        messages,
        tone: tone || 'professional',
        tenantId: effectiveTenantId,
      });

      sendJson(res, 200, { results: result });
    } catch (err) {
      logger.error('Erro ao reescrever múltiplas mensagens:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao reescrever mensagens',
      });
    }
    return true;
  }

  return false;
}