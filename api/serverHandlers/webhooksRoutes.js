// Webhooks Routes - Gerenciamento de webhooks customizados
async function handleWebhooksRoutes({
  req, res, method, pathname,
  deps: {
    requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
    logAction, logger,
    getAvailableEvents, listWebhooks, getWebhook, createWebhook, updateWebhook, deleteWebhook,
  }
}) {
  // GET /webhooks/events - Lista eventos disponíveis
  if (method === 'GET' && pathname === '/webhooks/events') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const events = getAvailableEvents();
    sendJson(res, 200, { events });
    return true;
  }

  // GET /webhooks - Lista webhooks do tenant
  if (method === 'GET' && pathname === '/webhooks') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const webhooksList = listWebhooks(req.tenantId);
    sendJson(res, 200, { webhooks: webhooksList });
    return true;
  }

  // GET /webhooks/:id - Obtém webhook específico
  if (method === 'GET' && pathname.startsWith('/webhooks/') && !pathname.startsWith('/webhooks/events')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const webhookId = pathname.split('/')[2];
    const webhook = getWebhook(webhookId);

    if (!webhook) {
      sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
      return true;
    }

    // Verifica se pertence ao tenant do agente
    if (webhook.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
      return true;
    }

    sendJson(res, 200, { webhook });
    return true;
  }

  // POST /webhooks - Cria novo webhook
  if (method === 'POST' && pathname === '/webhooks') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'webhooks', 'create');
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
      
      // Usa tenantId do agente autenticado
      const webhookData = {
        ...body,
        tenantId: body.tenantId || req.tenantId,
      };

      const result = createWebhook(webhookData);

      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'create',
        resource: 'webhook',
        details: { webhookId: result.webhook.id },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { webhook: result.webhook });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar webhook:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao criar webhook' });
      }
    }
    return true;
  }

  // PUT /webhooks/:id - Atualiza webhook
  if (method === 'PUT' && pathname.startsWith('/webhooks/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'webhooks', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const webhookId = pathname.split('/')[2];
      const existingWebhook = getWebhook(webhookId);

      if (!existingWebhook) {
        sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
        return true;
      }

      // Verifica se pertence ao tenant do agente
      if (existingWebhook.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
        return true;
      }

      const body = await parseJsonBody(req);
      const result = updateWebhook(webhookId, body);

      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'update',
        resource: 'webhook',
        details: { webhookId },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { webhook: result.webhook });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar webhook:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao atualizar webhook' });
      }
    }
    return true;
  }

  // DELETE /webhooks/:id - Deleta webhook
  if (method === 'DELETE' && pathname.startsWith('/webhooks/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'webhooks', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const webhookId = pathname.split('/')[2];
    const existingWebhook = getWebhook(webhookId);

    if (!existingWebhook) {
      sendJson(res, 404, { error: 'not_found', message: 'Webhook não encontrado' });
      return true;
    }

    // Verifica se pertence ao tenant do agente
    if (existingWebhook.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado' });
      return true;
    }

    const result = deleteWebhook(webhookId);

    if (!result.success) {
      sendJson(res, 400, { error: 'validation_error', message: result.error });
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'delete',
      resource: 'webhook',
      details: { webhookId },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}

module.exports = { handleWebhooksRoutes };
