module.exports = { handleWhatsappTemplateRoutes };

async function handleWhatsappTemplateRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    listTemplates,
    getTemplate,
    createTemplate,
    sendTemplateMessage,
  } = deps;

  if (method === 'GET' && pathname === '/whatsapp/templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const templates = await listTemplates();
      sendJson(res, 200, { templates });
    } catch (err) {
      logger.error('Erro ao listar templates:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/whatsapp/templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/whatsapp/templates/'.length));
      const template = await getTemplate(id);

      if (!template) {
        sendJson(res, 404, { error: 'template_not_found' });
        return true;
      }

      sendJson(res, 200, { template });
    } catch (err) {
      logger.error('Erro ao obter template:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'create');
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
      const result = await createTemplate(body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'whatsapp_template_create',
        resource: 'whatsapp_template',
        resourceId: result.templateId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { templateId: result.templateId });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar template:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/send-template') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
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
      const { to, templateName, languageCode, parameters } = body || {};

      if (!to || !templateName) {
        badRequest(res, 'Campos "to" e "templateName" são obrigatórios');
        return true;
      }

      const result = await sendTemplateMessage(
        to,
        templateName,
        languageCode || 'pt_BR',
        parameters || [],
        { tenantId: req.tenantId }
      );

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar template:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}