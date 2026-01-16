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

/**
 * Helper padronizado: Busca tenant por tenant_key ou id (UUID).
 * Reutiliza a função do tenantService para garantir consistência.
 * CONVENÇÃO: Prefira usar tenant_key em APIs públicas e URLs.
 * 
 * @param {string} identifier - tenant_key (ex: "tenant-demo") ou id (UUID)
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
  try {
    const sequelize = getSequelize();
    if (!sequelize) {
      await connect();
    }

    // Usa função helper padronizada para buscar tenant
    const tenant = await findTenantByIdentifier(tenantKey);

    if (!tenant) {
      return null;
    }

    const { TenantAISetting } = getModels();
    const aiSetting = await TenantAISetting.findOne({
      where: { tenant_id: tenant.id },
    });

    if (!aiSetting) {
      // Retorna configuração padrão
      return {
        primary: null,
        secondary: null,
        configured: false,
      };
    }

    // Retorna primary e secondary (provider vira primary para compatibilidade)
    return {
      primary: aiSetting.primary || aiSetting.provider || null,
      secondary: aiSetting.secondary || null,
      configured: !!(aiSetting.primary || aiSetting.provider),
      // Mantém campos antigos para compatibilidade
      enabled: aiSetting.enabled,
      provider: aiSetting.primary || aiSetting.provider,
      model: aiSetting.model,
      temperature: aiSetting.temperature ? parseFloat(aiSetting.temperature) : null,
      max_tokens: aiSetting.max_tokens,
      quota_monthly: aiSetting.quota_monthly,
    };
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
    const primaryProvider = config.primary || config.provider || null;
    const secondaryProvider = config.secondary || null;

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
        provider: provider,
      },
    });

    if (credential) {
      await credential.update({
        api_key_encrypted: encrypted,
      });
    } else {
      await TenantAICredential.create({
        tenant_id: tenant.id,
        provider: provider,
        api_key_encrypted: encrypted,
      });
    }

    logger.info(`[TenantAIService] Credencial ${provider} salva para tenant ${tenantKey}`);
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
        provider: provider,
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
        provider: provider,
      },
    });

    return !!credential;
  } catch (err) {
    logger.error('[TenantAIService] Erro ao verificar credenciais:', err);
    return false;
  }
}

module.exports = {
  getAIConfig,
  saveAIConfig,
  saveAICredentials,
  getDecryptedAPIKey,
  hasCredentials,
};
