/**
 * Serviço de gerenciamento de configurações de IA por tenant
 * 
 * Responsabilidades:
 * - Obter configurações de IA (sem segredos)
 * - Salvar configurações de IA
 * - Gerenciar credenciais (criptografadas)
 * - Validar RBAC
 */

const { connect, getSequelize } = require('../db/sequelize');
const { Tenant, TenantAISetting, TenantAICredential } = require('../db/models');
const { findTenantByIdentifier: findTenantByIdentifierFromService } = require('./tenantService');

// Helper para obter models (suporta lazy loading)
function getModels() {
  return {
    Tenant: typeof Tenant === 'function' ? Tenant() : Tenant,
    TenantAISetting: typeof TenantAISetting === 'function' ? TenantAISetting() : TenantAISetting,
    TenantAICredential: typeof TenantAICredential === 'function' ? TenantAICredential() : TenantAICredential,
  };
}
const { encrypt, decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');
const { SUPPORTED_PROVIDER_IDS } = require('../../engine/aiProviderRegistry');
const aiProviderRegistryService = require('./aiProviderRegistryService');

// Mantido como fallback estático (built-ins). A validação em runtime consulta
// o registry dinâmico (built-ins + custom) via aiProviderRegistryService.
const SUPPORTED_AI_PROVIDERS = new Set(SUPPORTED_PROVIDER_IDS);

// ---------------------------------------------------------------------------
// Cache em memória de getAIConfig (TTL 60s) — chamada por request e custa 2
// queries (tenant + tenant_ai_settings). Chave: identifier exato passado pelo
// caller (tenant_key ou UUID). Hits retornam cópia (structuredClone) para o
// caller não mutar o valor cacheado. Todo write de TenantAISetting
// (saveAIConfig) invalida as chaves afetadas.
// ---------------------------------------------------------------------------
const AI_CONFIG_CACHE_TTL_MS = 60 * 1000;

/** @type {Map<string, { value: Object|null, expiresAt: number }>} */
const aiConfigCache = new Map();

function invalidateAIConfigCache(identifier) {
  if (identifier === undefined || identifier === null) return;
  aiConfigCache.delete(String(identifier));
}

function normalizeProvider(provider) {
  if (typeof provider !== 'string') return null;
  const normalized = provider.trim().toLowerCase();
  return normalized || null;
}

async function assertSupportedProvider(provider, fieldName = 'provider') {
  const supported = await aiProviderRegistryService.isSupportedProvider(provider);
  if (!provider || !supported) {
    const ids = await aiProviderRegistryService.getProviderIds();
    throw new Error(`${fieldName} inválido. Suportados: ${ids.join(', ')}`);
  }
}

/**
 * Helper padronizado: Busca tenant por tenant_key ou id (UUID).
 * Reutiliza a função do tenantService para garantir consistência.
 * CONVENÇÃO: Prefira usar tenant_key em APIs públicas e URLs.
 * 
 * @param {string} identifier - tenant_key (ex: "tenant-acme") ou id (UUID)
 * @returns {Promise<Tenant|null>} Instância do Sequelize ou null
 */
async function findTenantByIdentifier(identifier) {
  try {
    return await findTenantByIdentifierFromService(identifier);
  } catch (err) {
    logger.error('[TenantAIService] Erro ao buscar tenant:', err);
    return null;
  }
}

/**
 * Obtém configurações de IA de um tenant (sem segredos).
 * 
 * @param {string} tenantKey - Chave do tenant
 * @returns {Promise<Object|null>} Configurações de IA ou null se não encontrado
 */
async function getAIConfig(tenantKey) {
  const cacheKey = String(tenantKey);
  const cached = aiConfigCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.value === null ? null : structuredClone(cached.value);
    }
    aiConfigCache.delete(cacheKey);
  }

  try {
    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    // Usa função helper padronizada para buscar tenant
    const tenant = await findTenantByIdentifier(tenantKey);

    if (!tenant) {
      aiConfigCache.set(cacheKey, { value: null, expiresAt: Date.now() + AI_CONFIG_CACHE_TTL_MS });
      return null;
    }

    const { TenantAISetting } = getModels();
    const aiSetting = await TenantAISetting.findOne({
      where: { tenant_id: tenant.id },
    });

    // Status de credenciais por provider (uma única query em TenantAICredential)
    const providersStatus = await getCredentialStatusMap(tenantKey, tenant);
    const supportedIds = await aiProviderRegistryService.getProviderIds();
    const providersMap = Object.fromEntries(
      supportedIds.map((id) => [id, { hasCredential: !!providersStatus[id] }]),
    );

    if (!aiSetting) {
      // Retorna configuração padrão
      const defaultConfig = {
        primary: null,
        secondary: null,
        configured: false,
        providers: providersMap,
      };
      aiConfigCache.set(cacheKey, { value: defaultConfig, expiresAt: Date.now() + AI_CONFIG_CACHE_TTL_MS });
      return structuredClone(defaultConfig);
    }

    // Retorna primary e secondary (provider vira primary para compatibilidade)
    const config = {
      primary: aiSetting.primary || aiSetting.provider || null,
      secondary: aiSetting.secondary || null,
      configured: !!(aiSetting.primary || aiSetting.provider),
      providers: providersMap,
      // Mantém campos antigos para compatibilidade
      enabled: aiSetting.enabled,
      provider: aiSetting.primary || aiSetting.provider,
      model: aiSetting.model,
      temperature: aiSetting.temperature ? parseFloat(aiSetting.temperature) : null,
      max_tokens: aiSetting.max_tokens,
      quota_monthly: aiSetting.quota_monthly,
    };
    aiConfigCache.set(cacheKey, { value: config, expiresAt: Date.now() + AI_CONFIG_CACHE_TTL_MS });
    return structuredClone(config);
  } catch (err) {
    logger.error('[TenantAIService] Erro ao obter configuração de IA:', err);
    throw err;
  }
}

/**
 * Salva configurações de IA de um tenant.
 * 
 * @param {string} tenantKey - Chave do tenant
 * @param {Object} config - Configurações de IA
 * @returns {Promise<Object>} Configurações salvas
 */
async function saveAIConfig(tenantKey, config) {
  try {
    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    const { TenantAISetting } = getModels();

    // Usa função helper padronizada para buscar tenant
    logger.debug('[TenantAIService] saveAICredentials: buscando tenant', { tenantKey });
    const tenant = await findTenantByIdentifier(tenantKey);

    if (!tenant) {
      logger.error('[TenantAIService] saveAICredentials: tenant não encontrado', { tenantKey });
      throw new Error(`Tenant ${tenantKey} não encontrado`);
    }

    logger.debug('[TenantAIService] saveAICredentials: tenant encontrado', { 
      tenantKey, 
      tenant_id: tenant.id, 
      tenant_key: tenant.tenant_key 
    });

    const aiSetting = await TenantAISetting.findOne({
      where: { tenant_id: tenant.id },
    });

    // Suporta primary/secondary ou provider (para compatibilidade)
    const primaryProvider = normalizeProvider(config.primary || config.provider || null);
    const secondaryProvider = normalizeProvider(config.secondary || null);

    if (primaryProvider) {
      await assertSupportedProvider(primaryProvider, 'primary');
    }
    if (secondaryProvider) {
      await assertSupportedProvider(secondaryProvider, 'secondary');
    }
    if (primaryProvider && secondaryProvider && primaryProvider === secondaryProvider) {
      throw new Error('secondary deve ser diferente de primary');
    }

    const settingData = {
      enabled: config.enabled !== false,
      provider: primaryProvider || 'openai', // Mantém para compatibilidade
      primary: primaryProvider,
      secondary: secondaryProvider,
      model: config.model || null,
      temperature: config.temperature !== undefined ? config.temperature : null,
      max_tokens: config.max_tokens || null,
      quota_monthly: config.quota_monthly || null,
    };

    if (aiSetting) {
      await aiSetting.update(settingData);
    } else {
      await TenantAISetting.create({
        tenant_id: tenant.id,
        ...settingData,
      });
    }

    // Usa o tenant_key do tenant encontrado para garantir consistência
    const finalTenantKey = tenant.tenant_key || tenantKey;
    // Invalida o cache de getAIConfig para todas as chaves que podem ter sido
    // usadas (identifier exato do caller e tenant_key resolvido).
    invalidateAIConfigCache(tenantKey);
    invalidateAIConfigCache(finalTenantKey);
    return await getAIConfig(finalTenantKey);
  } catch (err) {
    logger.error('[TenantAIService] Erro ao salvar configuração de IA:', err);
    throw err;
  }
}

/**
 * Salva credenciais de IA de um tenant (criptografadas).
 * 
 * @param {string} tenantKey - Chave do tenant
 * @param {string} provider - Provider (openai, anthropic, etc.)
 * @param {string} apiKey - API key (será criptografada)
 * @returns {Promise<void>}
 */
async function saveAICredentials(tenantKey, provider, apiKey) {
  try {
    const normalizedProvider = normalizeProvider(provider);
    await assertSupportedProvider(normalizedProvider);

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('API key não pode estar vazia');
    }

    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    const { TenantAICredential } = getModels();

    // Usa função helper padronizada para buscar tenant
    logger.debug('[TenantAIService] saveAICredentials: buscando tenant', { tenantKey });
    const tenant = await findTenantByIdentifier(tenantKey);

    if (!tenant) {
      logger.error('[TenantAIService] saveAICredentials: tenant não encontrado', { tenantKey });
      throw new Error(`Tenant ${tenantKey} não encontrado`);
    }

    logger.debug('[TenantAIService] saveAICredentials: tenant encontrado', { 
      tenantKey, 
      tenant_id: tenant.id, 
      tenant_key: tenant.tenant_key 
    });

    const encrypted = encrypt(apiKey.trim());

    const credential = await TenantAICredential.findOne({
      where: {
        tenant_id: tenant.id,
        provider: normalizedProvider,
      },
    });

    if (credential) {
      await credential.update({
        api_key_encrypted: encrypted,
      });
    } else {
      await TenantAICredential.create({
        tenant_id: tenant.id,
        provider: normalizedProvider,
        api_key_encrypted: encrypted,
      });
    }

    // Invalida o cache de getAIConfig para que o status de credenciais
    // (providers) seja recalculado na próxima leitura.
    invalidateAIConfigCache(tenantKey);
    invalidateAIConfigCache(tenant.tenant_key || tenantKey);

    logger.info(`[TenantAIService] Credencial ${normalizedProvider} salva para tenant ${tenantKey}`);
  } catch (err) {
    logger.error('[TenantAIService] Erro ao salvar credenciais de IA:', err);
    throw err;
  }
}

/**
 * Obtém API key descriptografada de um tenant (apenas para uso interno no backend).
 * 
 * @param {string} tenantKey - Chave do tenant
 * @param {string} provider - Provider (openai, anthropic, etc.)
 * @returns {Promise<string|null>} API key descriptografada ou null se não encontrada
 */
async function getDecryptedAPIKey(tenantKey, provider) {
  try {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) return null;

    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    const { Tenant, TenantAICredential } = getModels();

    // Tenta buscar por tenant_key primeiro, depois por id (caso seja UUID)
    let tenant = await Tenant.findOne({
      where: { tenant_key: tenantKey },
    });

    // Se não encontrou por tenant_key e parece ser UUID, tenta buscar por id
    if (!tenant && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantKey)) {
      tenant = await Tenant.findOne({
        where: { id: tenantKey },
      });
    }

    if (!tenant) {
      return null;
    }

    const credential = await TenantAICredential.findOne({
      where: {
        tenant_id: tenant.id,
        provider: normalizedProvider,
      },
    });

    if (!credential) {
      return null;
    }

    return decrypt(credential.api_key_encrypted);
  } catch (err) {
    logger.error('[TenantAIService] Erro ao obter API key descriptografada:', err);
    throw err;
  }
}

/**
 * Verifica se um tenant tem credenciais configuradas para um provider.
 * 
 * @param {string} tenantKey - Chave do tenant
 * @param {string} provider - Provider
 * @returns {Promise<boolean>}
 */
async function hasCredentials(tenantKey, provider) {
  try {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) return false;

    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    const { Tenant, TenantAICredential } = getModels();

    // Tenta buscar por tenant_key primeiro, depois por id (caso seja UUID)
    let tenant = await Tenant.findOne({
      where: { tenant_key: tenantKey },
    });

    // Se não encontrou por tenant_key e parece ser UUID, tenta buscar por id
    if (!tenant && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantKey)) {
      tenant = await Tenant.findOne({
        where: { id: tenantKey },
      });
    }

    if (!tenant) {
      return false;
    }

    const credential = await TenantAICredential.findOne({
      where: {
        tenant_id: tenant.id,
        provider: normalizedProvider,
      },
    });

    return !!credential;
  } catch (err) {
    logger.error('[TenantAIService] Erro ao verificar credenciais:', err);
    return false;
  }
}

/**
 * Retorna um mapa { providerId: boolean } indicando quais providers têm
 * credencial salva para o tenant (uma única query).
 *
 * @param {string} tenantKey - Chave do tenant (ou UUID)
 * @param {Object} [resolvedTenant] - Instância de Tenant já resolvida (evita re-resolução)
 * @returns {Promise<Object<string, boolean>>}
 */
async function getCredentialStatusMap(tenantKey, resolvedTenant = null) {
  const ids = await aiProviderRegistryService.getProviderIds();
  const status = {};
  for (const id of ids) status[id] = false;

  try {
    const tenant = resolvedTenant || await findTenantByIdentifier(tenantKey);
    if (!tenant) return status;

    const { TenantAICredential } = getModels();
    const credentials = await TenantAICredential.findAll({
      where: { tenant_id: tenant.id },
      attributes: ['provider'],
    });

    for (const cred of credentials) {
      const pid = normalizeProvider(cred.provider);
      if (pid && Object.prototype.hasOwnProperty.call(status, pid)) {
        status[pid] = true;
      }
    }
    return status;
  } catch (err) {
    logger.error('[TenantAIService] Erro ao obter status de credenciais:', err);
    return status;
  }
}

module.exports = {
  getAIConfig,
  saveAIConfig,
  saveAICredentials,
  getDecryptedAPIKey,
  hasCredentials,
  getCredentialStatusMap,
  invalidateAIConfigCache,
  SUPPORTED_AI_PROVIDERS,
  // Funções internas para testes
  _internal: {
    clearAIConfigCache: () => aiConfigCache.clear(),
  },
};
