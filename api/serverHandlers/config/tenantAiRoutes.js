const { validateProviderCredentials } = require('./configRouteUtils');

async function handleConfigTenantAiRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    getAIConfig,
    saveAIConfig,
    saveAICredentials,
    getDecryptedAPIKey,
    isSuperAdmin,
    emitEvent,
  } = deps;

  const isTenantAiRoute =
    pathname === '/tenants/current/ai-config' ||
    pathname === '/tenants/current/ai-credentials' ||
    /^\/tenants\/([^\/]+)\/ai-credentials\/test$/.test(pathname);

  if (!isTenantAiRoute) {
    return false;
  }

  // GET /tenants/current/ai-config
  if (method === 'GET' && pathname === '/tenants/current/ai-config') {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }

      let tenantId = authResult.agent.tenantId;
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId,
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return true;
      }

      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return true;
      }

      const aiConfig = await getAIConfig(tenantId);
      if (aiConfig === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Configuração de IA não encontrada para este tenant' });
        return true;
      }

      sendJson(res, 200, aiConfig);
    } catch (err) {
      logger.error('Erro ao obter configuração de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao obter configuração de IA', message: err.message });
    }
    return true;
  }

  // PUT /tenants/current/ai-config
  if (method === 'PUT' && pathname === '/tenants/current/ai-config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }

      let tenantId = authResult.agent.tenantId;
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId,
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return true;
      }

      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return true;
      }

      const permResult = requirePermission(req, 'config', 'update');
      const isSuperAdminUser = isSuperAdmin(authResult.agent);
      if (!permResult.allowed && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar configurações de IA' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return true;
      }

      const savedConfig = await saveAIConfig(tenantId, body);
      sendJson(res, 200, savedConfig);
    } catch (err) {
      logger.error('Erro ao salvar configuração de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao salvar configuração de IA', message: err.message });
    }
    return true;
  }

  // PUT /tenants/current/ai-credentials
  if (method === 'PUT' && pathname === '/tenants/current/ai-credentials') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }

      let tenantId = authResult.agent.tenantId;
      if (tenantId === 'current') {
        logger.error('[Server] tenantId inválido: "current" (string literal). Agente:', {
          id: authResult.agent.id,
          username: authResult.agent.username,
          role: authResult.agent.role,
          tenantId: authResult.agent.tenantId,
        });
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' });
        return true;
      }

      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return true;
      }

      const permResult = requirePermission(req, 'config', 'update');
      const isSuperAdminUser = isSuperAdmin(authResult.agent);
      if (!permResult.allowed && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para alterar credenciais de IA' });
        return true;
      }

      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Body deve ser um objeto JSON válido' });
        return true;
      }

      const { provider, apiKey } = body;
      if (!provider || typeof provider !== 'string') {
        sendJson(res, 400, { error: 'invalid_request', message: 'Provider é obrigatório' });
        return true;
      }
      if (!apiKey || typeof apiKey !== 'string') {
        sendJson(res, 400, { error: 'invalid_request', message: 'API key é obrigatória' });
        return true;
      }

      await saveAICredentials(tenantId, provider, apiKey);
      sendJson(res, 200, { success: true, message: 'Credenciais salvas com sucesso' });
    } catch (err) {
      logger.error('Erro ao salvar credenciais de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao salvar credenciais de IA', message: err.message });
    }
    return true;
  }

  // POST /tenants/:tenantKey/ai-credentials/test
  if (method === 'POST' && pathname.match(/^\/tenants\/([^\/]+)\/ai-credentials\/test$/)) {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const match = pathname.match(/^\/tenants\/([^\/]+)\/ai-credentials\/test$/);
    let tenantKey = decodeURIComponent(match[1]);

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }

      if (tenantKey === 'current') {
        tenantKey = authResult.agent?.tenantId;
      }
      if (!tenantKey || tenantKey === 'current') {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente ou inválido' });
        return true;
      }

      const isSuperAdminUser = isSuperAdmin(authResult.agent);
      if (!isSuperAdminUser && authResult.agent.role !== 'admin' && authResult.agent.tenantId !== tenantKey) {
        sendJson(res, 403, { error: 'forbidden', message: 'Acesso negado a este tenant' });
        return true;
      }

      const body = await parseJsonBody(req);
      const providerOverride = body && typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : null;

      const aiCfg = await getAIConfig(tenantKey);
      if (aiCfg === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant não encontrado' });
        return true;
      }

      const configuredPrimary = aiCfg?.primary || aiCfg?.provider || null;
      const providerToTest = providerOverride || configuredPrimary;
      if (!providerToTest) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          provider: null,
          tenantId: tenantKey,
          error: 'Provider primário não configurado para o tenant',
        });
        return true;
      }

      const apiKey = await getDecryptedAPIKey(tenantKey, providerToTest);
      if (!apiKey || !String(apiKey).trim()) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          provider: providerToTest,
          tenantId: tenantKey,
          error: `Credencial não configurada para o provider ${providerToTest}`,
        });
        return true;
      }

      const validation = await validateProviderCredentials(providerToTest, apiKey);
      const isValid = validation.valid;
      const error = validation.error;

      try {
        const executionIdHeader = (req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const executionId = (typeof executionIdHeader === 'string' && executionIdHeader.trim()) ? executionIdHeader.trim() : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId && isValid === true) {
          emitEvent('pipeline.status', {
            executionId,
            status: 'running',
            stages: { providerValidated: true },
            metadata: { message: 'Provider de IA validado', source: '/tenants/current/ai-credentials/test', provider: providerToTest },
          }, { tenantId: tenantKey });
        }
      } catch (_) {}

      sendJson(res, 200, {
        success: true,
        valid: isValid === true,
        provider: providerToTest,
        tenantId: tenantKey,
        error: error || null,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao validar credenciais salvas do tenant:', err);
        sendJson(res, 500, {
          success: false,
          valid: false,
          error: err.message || 'Erro ao validar credenciais salvas do tenant',
        });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleConfigTenantAiRoutes };
