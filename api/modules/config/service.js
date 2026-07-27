'use strict';

const path = require('path');
const fs = require('fs');
const appConfig = require('../../utils/config');

const dataDir = path.join(__dirname, '..', '..', 'data');
const configFile = path.join(dataDir, 'config.json');
const contractsDir = path.join(__dirname, '..', '..', '..', 'contracts');
const rulesFile = path.join(contractsDir, 'rag', 'question-generation.rules.json');

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

    if (provider === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cleanApiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return Array.isArray(data?.data)
          ? { valid: true, error: null }
          : { valid: false, error: 'Resposta inválida da API DeepSeek' };
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

function parseTenantKey(req, authResult) {
  let tenantId = authResult.agent.tenantId;
  if (tenantId === 'current') {
    return { error: 'tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.' };
  }
  if (!tenantId) {
    return { error: 'Agente não possui tenantId' };
  }
  return { tenantId };
}

function parseProviderTokenBody(body) {
  return {
    provider: body?.provider,
    apiKey: body?.apiKey,
  };
}

function validateRedisUrl(redisUrl) {
  if (!redisUrl || typeof redisUrl !== 'string' || redisUrl.trim() === '') {
    return { valid: false, error: 'URL do Redis não pode estar vazia' };
  }

  const redisUrlPattern = /^(redis|rediss):\/\/([^:\/]+)(:(\d+))?(\/.*)?$/;
  const match = redisUrl.trim().match(redisUrlPattern);
  if (!match) {
    return { valid: false, error: 'Formato de URL inválido. Formato esperado: redis://host:port ou rediss://host:port' };
  }

  const port = match[4];
  if (port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, error: `Porta inválida: ${port}. Deve ser um número entre 1 e 65535` };
    }
  }

  return { valid: true };
}

function readPath(obj, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function evaluateIntegrationReadiness(configData = {}) {
  const missing = [];
  const addMissing = (path, reason) => missing.push({ path, reason });

  const provider = readPath(configData, 'billing.provider');
  if (!provider || typeof provider !== 'string' || !provider.trim()) {
    addMissing('billing.provider', 'Provider de billing obrigatório (asaas ou mercado_pago)');
  }

  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (normalizedProvider === 'asaas') {
    const asaasRequired = [
      'billing.providers.asaas.baseUrl',
      'billing.providers.asaas.apiKey',
      'billing.providers.asaas.webhookSecret',
    ];
    for (const path of asaasRequired) {
      const value = readPath(configData, path);
      if (value === undefined || value === null || String(value).trim() === '') {
        addMissing(path, 'Campo obrigatório para provider Asaas');
      }
    }
  } else if (normalizedProvider === 'mercado_pago' || normalizedProvider === 'mercadopago' || normalizedProvider === 'mp') {
    const mpRequired = [
      'billing.providers.mercadoPago.baseUrl',
      'billing.providers.mercadoPago.accessToken',
      'billing.providers.mercadoPago.webhookSecret',
    ];
    for (const path of mpRequired) {
      const value = readPath(configData, path);
      if (value === undefined || value === null || String(value).trim() === '') {
        addMissing(path, 'Campo obrigatório para provider Mercado Pago');
      }
    }
  } else if (provider) {
    addMissing('billing.provider', `Provider inválido: ${provider}`);
  }

  const notificationFlags = [
    'notifications.whatsapp.enabled',
    'notifications.sms.enabled',
    'notifications.email.enabled',
  ];
  for (const path of notificationFlags) {
    const value = readPath(configData, path);
    if (typeof value !== 'boolean') {
      addMissing(path, 'Flag obrigatória (true/false)');
    }
  }

  const whatsappEnabled = readPath(configData, 'notifications.whatsapp.enabled') === true;
  if (whatsappEnabled) {
    const whatsappRequired = [
      'whatsapp.apiUrl',
      'whatsapp.phoneNumberId',
      'whatsapp.accessToken',
      'whatsapp.verifyToken',
    ];
    for (const path of whatsappRequired) {
      const value = readPath(configData, path);
      if (value === undefined || value === null || String(value).trim() === '') {
        addMissing(path, 'Campo obrigatório quando notifications.whatsapp.enabled=true');
      }
    }
  }

  const emailEnabled = readPath(configData, 'notifications.email.enabled') === true;
  if (emailEnabled) {
    const emailRequired = [
      'notifications.email.smtp.host',
      'notifications.email.smtp.port',
      'notifications.email.fromAddress',
    ];
    for (const path of emailRequired) {
      const value = readPath(configData, path);
      if (value === undefined || value === null || String(value).trim() === '') {
        addMissing(path, 'Campo obrigatório quando notifications.email.enabled=true');
      }
    }
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

async function validateRedisConnection(redisUrl) {
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
    await testClient.quit();

    return { valid: pingResult === 'PONG', error: null };
  } catch (validationError) {
    if (validationError.message && validationError.message.includes('Timeout')) {
      return { valid: false, error: 'Timeout ao conectar ao Redis. Verifique se o servidor está rodando e acessível.' };
    }
    if (validationError.message && (validationError.message.includes('ECONNREFUSED') || validationError.message.includes('connect ECONNREFUSED'))) {
      return { valid: false, error: 'Conexão recusada. Verifique se o Redis está rodando e se a porta está correta.' };
    }
    if (validationError.message && (validationError.message.includes('ENOTFOUND') || validationError.message.includes('getaddrinfo'))) {
      return { valid: false, error: 'Host não encontrado. Verifique se o endereço do Redis está correto.' };
    }
    if (validationError.message && validationError.message.includes('invalid password')) {
      return { valid: false, error: 'Senha inválida. Verifique as credenciais do Redis.' };
    }
    return { valid: false, error: validationError.message || 'Erro ao conectar ao Redis' };
  }
}

function createConfigService({ deps }) {
  return {
    reloadAndReadConfig() {
      appConfig.reload();
      const configData = appConfig.getAll();
      const rawConfig = appConfig.loadConfig();
      if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
        throw new Error('Configuração retornada não é um objeto válido');
      }
      const sanitizedConfig = JSON.parse(JSON.stringify(configData));
      if (sanitizedConfig.ai) delete sanitizedConfig.ai;
      sanitizedConfig.configValidation = {
        integrations: evaluateIntegrationReadiness(rawConfig || {}),
      };
      return sanitizedConfig;
    },

    /**
     * Visão pública (pré-login) da configuração: apenas sinalizadores de
     * prontidão de integrações e feature flags. Nunca inclui credenciais,
     * URLs internas, tokens ou dados de conexão. Usada pelo onboarding antes
     * da autenticação — o payload completo exige auth + config:read.
     */
    readPublicConfig() {
      appConfig.reload();
      const rawConfig = appConfig.loadConfig() || {};
      const configData = appConfig.getAll() || {};
      return {
        public: true,
        features: configData.features && typeof configData.features === 'object'
          ? JSON.parse(JSON.stringify(configData.features))
          : {},
        configValidation: {
          integrations: evaluateIntegrationReadiness(rawConfig),
        },
      };
    },

    readQuestionGenerationRules() {
      if (!fs.existsSync(rulesFile)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    },

    parseTenantKey,
    parseProviderTokenBody,

    async getCurrentTenantAiConfig(tenantId) {
      return deps.getAIConfig(tenantId);
    },

    async saveCurrentTenantAiConfig(tenantId, body) {
      return deps.saveAIConfig(tenantId, body);
    },

    async saveCurrentTenantAiCredentials(tenantId, provider, apiKey) {
      return deps.saveAICredentials(tenantId, provider, apiKey);
    },

    async testStoredTenantCredentials({ tenantKey, providerOverride, req, authResult }) {
      let resolvedTenantKey = tenantKey === 'current' ? authResult.agent?.tenantId : tenantKey;
      if (!resolvedTenantKey || resolvedTenantKey === 'current') {
        return { kind: 'bad_request', message: 'tenantId ausente ou inválido' };
      }

      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!isSuperAdminUser && authResult.agent.role !== 'admin' && authResult.agent.tenantId !== resolvedTenantKey) {
        return { kind: 'forbidden', message: 'Acesso negado a este tenant' };
      }

      const aiCfg = await deps.getAIConfig(resolvedTenantKey);
      if (aiCfg === null) {
        return { kind: 'not_found', message: 'Tenant não encontrado' };
      }

      const configuredPrimary = aiCfg?.primary || aiCfg?.provider || null;
      const providerToTest = providerOverride || configuredPrimary;
      if (!providerToTest) {
        return {
          kind: 'ok',
          payload: {
            success: true,
            valid: false,
            provider: null,
            tenantId: resolvedTenantKey,
            error: 'Provider primário não configurado para o tenant',
          },
        };
      }

      const apiKey = await deps.getDecryptedAPIKey(resolvedTenantKey, providerToTest);
      if (!apiKey || !String(apiKey).trim()) {
        return {
          kind: 'ok',
          payload: {
            success: true,
            valid: false,
            provider: providerToTest,
            tenantId: resolvedTenantKey,
            error: `Credencial não configurada para o provider ${providerToTest}`,
          },
        };
      }

      const validation = await validateProviderCredentials(providerToTest, apiKey);

      try {
        const executionIdHeader =
          (req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const executionId =
          (typeof executionIdHeader === 'string' && executionIdHeader.trim()) ? executionIdHeader.trim() : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId && validation.valid === true) {
          deps.emitEvent('pipeline.status', {
            executionId,
            status: 'running',
            stages: { providerValidated: true },
            metadata: { message: 'Provider de IA validado', source: '/tenants/current/ai-credentials/test', provider: providerToTest },
          }, { tenantId: resolvedTenantKey });
        }
      } catch (_) {}

      return {
        kind: 'ok',
        payload: {
          success: true,
          valid: validation.valid === true,
          provider: providerToTest,
          tenantId: resolvedTenantKey,
          error: validation.error || null,
        },
      };
    },

    async persistConfigUpdate(body, logger) {
      ensureDataDir();
      const payload = JSON.parse(JSON.stringify(body || {}));
      if (payload && typeof payload === 'object') {
        delete payload.configValidation;
      }
      fs.writeFileSync(configFile, JSON.stringify(payload, null, 2), 'utf8');
      appConfig.reload();
      try {
        deps.initializeAiProviders();
        logger.info('Providers de IA reinicializados com nova configuração');
      } catch (aiError) {
        logger.warn('Erro ao reinicializar providers de IA', { message: aiError.message });
      }
      logger.info('Configuração atualizada via API - nodemon reiniciará o servidor automaticamente');
    },

    detectProcessManager() {
      return deps.detectProcessManager();
    },

    validateProviderToken: validateProviderCredentials,
    validateRedisUrl,
    validateRedisConnection,
  };
}

module.exports = {
  createConfigService,
};
