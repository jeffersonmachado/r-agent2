const path = require('path');
const fs = require('fs');
const config = require('../utils/config');

const dataDir = path.join(__dirname, '..', 'data');
const configFile = path.join(dataDir, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

async function validateProviderCredentials(provider, apiKey) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    return { valid: false, error: 'Token não pode estar vazio' };
  }

  try {
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cleanApiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return Array.isArray(data?.data)
          ? { valid: true, error: null }
          : { valid: false, error: 'Resposta inválida da API OpenAI' };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
    }

    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': cleanApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return data?.content
          ? { valid: true, error: null }
          : { valid: false, error: 'Resposta inválida da API Anthropic' };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
    }

    return { valid: false, error: 'Provider não suportado' };
  } catch (validationError) {
    if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
      return { valid: false, error: 'Timeout ao validar token. Verifique sua conexão com a internet.' };
    }
    if (validationError.name === 'TypeError' && String(validationError.message || '').includes('fetch')) {
      return { valid: false, error: 'Erro de conexão. Verifique sua conexão com a internet.' };
    }
    return { valid: false, error: validationError.message || 'Erro ao validar token' };
  }
}

module.exports = { handleConfigRoutes };

async function handleConfigRoutes({ req, res, method, pathname, deps }) {
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
    initializeAiProviders,
    isSuperAdmin,
    setCorsHeaders,
    emitEvent,
    detectProcessManager,
  } = deps;

  // GET /config - Lê a configuração atual
  if (method === 'GET' && pathname === '/config') {
    const acceptHeader = req.headers.accept || '';
    const isApiRequest = acceptHeader.includes('application/json') || 
                         !acceptHeader.includes('text/html');
    
    if (!isApiRequest) {
      return false;
    } else {
      try {
        config.reload();
        const configData = config.getAll();
        
        if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
          throw new Error('Configuração retornada não é um objeto válido');
        }
        
        const sanitizedConfig = JSON.parse(JSON.stringify(configData));
        
        if (sanitizedConfig.ai) delete sanitizedConfig.ai;
        
        sendJson(res, 200, sanitizedConfig);
      } catch (err) {
        try {
          logger.error('Erro ao ler configuração:', err);
        } catch (logErr) {
          // eslint-disable-next-line no-console
          console.error('Erro ao ler configuração:', err);
          // eslint-disable-next-line no-console
          console.error('Erro ao logar erro:', logErr);
        }
        
        sendJson(res, 500, { 
          error: 'Erro ao ler configuração',
          message: err.message || 'Erro desconhecido',
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
      }
      return true;
    }
  }

  // GET /contracts/rag/question-generation.rules.json - Serve regras de geração de perguntas
  if (method === 'GET' && (pathname === '/contracts/rag/question-generation.rules.json' || pathname === '/api/data/rag_question_generation_rules.json')) {
    try {
      const contractsDir = path.join(__dirname, '..', '..', 'contracts');
      const rulesFile = path.join(contractsDir, 'rag', 'question-generation.rules.json');
      
      if (!fs.existsSync(rulesFile)) {
        sendJson(res, 404, { error: 'not_found', message: 'Arquivo de regras não encontrado' });
        return true;
      }
      
      const rulesContent = fs.readFileSync(rulesFile, 'utf8');
      const rulesData = JSON.parse(rulesContent);
      
      setCorsHeaders(res);
      sendJson(res, 200, rulesData);
    } catch (err) {
      logger.error('Erro ao servir regras de geração de perguntas:', err);
      sendJson(res, 500, { 
        error: 'Erro ao ler regras',
        message: err.message || 'Erro desconhecido'
      });
    }
    return true;
  }

  // GET /tenants/current/ai-config - Obtém configuração de IA do tenant atual (sem segredos)
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
          tenantId: authResult.agent.tenantId
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

  // PUT /tenants/current/ai-config - Salva configuração de IA do tenant atual
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
          tenantId: authResult.agent.tenantId
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

  // PUT /tenants/current/ai-credentials - Salva credenciais de IA do tenant atual (criptografadas)
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
          tenantId: authResult.agent.tenantId
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
      
      sendJson(res, 200, { 
        success: true, 
        message: 'Credenciais salvas com sucesso' 
      });
    } catch (err) {
      logger.error('Erro ao salvar credenciais de IA do tenant atual:', err);
      sendJson(res, 500, { error: 'Erro ao salvar credenciais de IA', message: err.message });
    }
    return true;
  }

  // POST /tenants/current/ai-credentials/test - Valida credenciais salvas (criptografadas) do tenant atual
  if (method === 'POST' && pathname === '/tenants/current/ai-credentials/test') {
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
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId inválido: "current" não é um tenant válido.' });
        return true;
      }
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'Agente não possui tenantId' });
        return true;
      }

      const permResult = requirePermission(req, 'config', 'update');
      const isSuperAdminUser = isSuperAdmin(authResult.agent);
      if (!permResult.allowed && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'Permissão insuficiente para validar credenciais de IA' });
        return true;
      }

      const body = await parseJsonBody(req);
      const providerFromBody = body?.provider ? String(body.provider).trim() : null;

      const aiCfg = await getAIConfig(tenantId);

      const configuredPrimary = aiCfg?.primary || aiCfg?.provider || null;
      if (!aiCfg?.configured || !configuredPrimary) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          provider: null,
          error: 'Provider primário não configurado (salve a configuração de IA do tenant)',
        });
        return true;
      }

      const providerToTest = providerFromBody || configuredPrimary;
      if (providerFromBody && providerFromBody !== configuredPrimary) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          provider: providerFromBody,
          error: `Provider informado (${providerFromBody}) difere do provider primário configurado (${configuredPrimary}). Salve a configuração de IA.`,
        });
        return true;
      }

      if (providerToTest !== 'openai' && providerToTest !== 'anthropic') {
        sendJson(res, 200, { success: true, valid: false, provider: providerToTest, error: 'Provider não suportado' });
        return true;
      }

      const apiKey = await getDecryptedAPIKey(tenantId, providerToTest);
      if (!apiKey || !String(apiKey).trim()) {
        sendJson(res, 200, { success: true, valid: false, provider: providerToTest, error: 'Credenciais não encontradas para este provider' });
        return true;
      }

      const cleanApiKey = String(apiKey).trim();
      let isValid = false;
      let error = null;

      const validation = await validateProviderCredentials(providerToTest, cleanApiKey);
      isValid = validation.valid;
      error = validation.error;

      try {
        const executionIdHeader =
          (req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const executionId =
          (typeof executionIdHeader === 'string' && executionIdHeader.trim()) ? executionIdHeader.trim() : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId && isValid === true) {
          emitEvent('pipeline.status', {
            executionId,
            status: 'running',
            stages: { providerValidated: true },
            metadata: { message: 'Provider de IA validado', source: '/tenants/current/ai-credentials/test', provider: providerToTest },
          }, { tenantId });
        }
      } catch (_) {
        // best-effort: não bloquear validação por WS
      }

      sendJson(res, 200, { success: true, valid: isValid, provider: providerToTest, error: error || null });
    } catch (err) {
      logger.error('Erro ao validar credenciais de IA do tenant atual', err);
      sendJson(res, 500, { success: false, error: 'Erro ao validar credenciais', message: err.message });
    }
    return true;
  }

  // PUT /config - Atualiza a configuração
  if (method === 'PUT' && pathname === '/config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return true;
      }

      sendJson(res, 200, { 
        success: true, 
        message: 'Configuração atualizada com sucesso. Servidor será reiniciado automaticamente.' 
      });

      setImmediate(() => {
        try {
          ensureDataDir();
          const configData = JSON.stringify(body, null, 2);
          fs.writeFileSync(configFile, configData, 'utf8');
          
          config.reload();
          
          try {
            initializeAiProviders();
            logger.info('Providers de IA reinicializados com nova configuração');
          } catch (aiError) {
            logger.warn('Erro ao reinicializar providers de IA', { message: aiError.message });
          }
          
          logger.info('Configuração atualizada via API - nodemon reiniciará o servidor automaticamente');
        } catch (err) {
          logger.error('Erro ao salvar configuração após resposta', err);
        }
      });
    } catch (err) {
      logger.error('Erro ao atualizar configuração', err);
      sendJson(res, 500, { error: 'Erro ao atualizar configuração', message: err.message });
    }
    return true;
  }

  // GET /server/process-manager - Verifica qual gerenciador de processo está sendo usado
  if (method === 'GET' && pathname === '/server/process-manager') {
    const processManager = detectProcessManager();
    sendJson(res, 200, {
      success: true,
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      details: processManager.details,
    });
    return true;
  }

  // POST /config/validate-provider-token - Valida token de um provedor de IA
  if (method === 'POST' && pathname === '/config/validate-provider-token') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { provider, apiKey } = body;

      if (!provider || !apiKey) {
        badRequest(res, 'Provider e apiKey são obrigatórios');
        return true;
      }

      if (provider !== 'openai' && provider !== 'anthropic') {
        badRequest(res, 'Provider deve ser "openai" ou "anthropic"');
        return true;
      }

      const cleanApiKey = apiKey.trim();
      if (!cleanApiKey) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'Token não pode estar vazio',
        });
        return true;
      }

      const validation = await validateProviderCredentials(provider, cleanApiKey);

      sendJson(res, 200, {
        success: true,
        valid: validation.valid,
        error: validation.error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar token de provedor', err);
      sendJson(res, 500, { 
        success: false,
        error: 'Erro ao validar token', 
        message: err.message 
      });
    }
    return true;
  }

  // POST /config/validate-redis - Valida conexão do Redis
  if (method === 'POST' && pathname === '/config/validate-redis') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { redisUrl } = body;

      if (!redisUrl || typeof redisUrl !== 'string' || redisUrl.trim() === '') {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'URL do Redis não pode estar vazia',
        });
        return true;
      }

      const redisUrlPattern = /^(redis|rediss):\/\/([^:\/]+)(:(\d+))?(\/.*)?$/;
      const match = redisUrl.trim().match(redisUrlPattern);
      
      if (!match) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: `Formato de URL inválido. Formato esperado: redis://host:port ou rediss://host:port`,
        });
        return true;
      }

      const port = match[4];
      if (port) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          sendJson(res, 200, {
            success: true,
            valid: false,
            error: `Porta inválida: ${port}. Deve ser um número entre 1 e 65535`,
          });
          return true;
        }
      }

      let isValid = false;
      let error = null;

      try {
        const Redis = require('ioredis');
        const testClient = new Redis(redisUrl.trim(), {
          connectTimeout: 5000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });

        const connectPromise = testClient.connect();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao conectar ao Redis (5s)')), 5000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        
        const pingResult = await testClient.ping();
        isValid = pingResult === 'PONG';
        
        await testClient.quit();
        
      } catch (validationError) {
        if (validationError.message && validationError.message.includes('Timeout')) {
          error = 'Timeout ao conectar ao Redis. Verifique se o servidor está rodando e acessível.';
        } else if (validationError.message && (validationError.message.includes('ECONNREFUSED') || validationError.message.includes('connect ECONNREFUSED'))) {
          error = 'Conexão recusada. Verifique se o Redis está rodando e se a porta está correta.';
        } else if (validationError.message && (validationError.message.includes('ENOTFOUND') || validationError.message.includes('getaddrinfo'))) {
          error = 'Host não encontrado. Verifique se o endereço do Redis está correto.';
        } else if (validationError.message && validationError.message.includes('invalid password')) {
          error = 'Senha inválida. Verifique as credenciais do Redis.';
        } else {
          error = validationError.message || 'Erro ao conectar ao Redis';
        }
      }

      sendJson(res, 200, {
        success: true,
        valid: isValid,
        error: error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar conexão do Redis', err);
      sendJson(res, 500, { 
        success: false,
        error: 'Erro ao validar conexão do Redis', 
        message: err.message 
      });
    }
    return true;
  }

  // POST /server/restart - Reinicia o servidor
  if (method === 'POST' && pathname === '/server/restart') {
    logger.info('Reinício do servidor solicitado via API');
    
    const processManager = detectProcessManager();
    
    sendJson(res, 200, { 
      success: true, 
      message: processManager.hasProcessManager 
        ? 'Servidor será reiniciado automaticamente em breve'
        : 'Servidor será encerrado. Reinicie manualmente.',
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      note: processManager.hasProcessManager
        ? `Gerenciador detectado: ${processManager.name}. O servidor será reiniciado automaticamente.`
        : 'Nenhum gerenciador de processo detectado. Você precisará reiniciar o servidor manualmente usando "npm start" ou "node api/server.js".'
    });
    
    setTimeout(() => {
      logger.info('Encerrando servidor para reinício...');
      if (processManager.hasProcessManager) {
        logger.info(`Gerenciador ${processManager.name} irá reiniciar o servidor automaticamente`);
      } else {
        logger.warn('Nenhum gerenciador detectado. Servidor não será reiniciado automaticamente.');
      }
      process.exit(0);
    }, 500);
    
    return true;
  }

  return false;
}
