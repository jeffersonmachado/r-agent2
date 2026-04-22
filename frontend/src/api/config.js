import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções para gerenciar configuração do sistema.
 */

/**
 * Obtém a configuração atual do sistema.
 *
 * @returns {Promise<Object>} Configuração completa
 */
export async function getConfig() {
  try {
    return await fetchJson('/config', {
      method: 'GET',
    });
  } catch (error) {
    logger.error('Erro ao carregar configuração', error);
    throw error;
  }
}

/**
 * Obtém diagnóstico de prontidão de integrações a partir do payload de /config.
 * O backend não bloqueia startup; o frontend usa este método para orientar configuração pendente.
 */
export async function getIntegrationConfigReadiness() {
  const cfg = await getConfig();
  const integrations = cfg?.configValidation?.integrations;
  return {
    ready: Boolean(integrations?.ready),
    missing: Array.isArray(integrations?.missing) ? integrations.missing : [],
  };
}

/**
 * Atualiza a configuração do sistema.
 *
 * @param {Object} configData - Objeto com a configuração completa
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function updateConfig(configData) {
  try {
    if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
      throw new Error('Configuração deve ser um objeto válido');
    }

    return await fetchJson('/config', {
      method: 'PUT',
      body: JSON.stringify(configData),
    });
  } catch (error) {
    logger.error('Erro ao atualizar configuração', error);
    throw error;
  }
}

/**
 * Recarrega a configuração do servidor (útil após edições manuais).
 *
 * @returns {Promise<Object>} Nova configuração carregada
 */
export async function reloadConfig() {
  try {
    // Primeiro atualiza (isso força reload no servidor)
    const current = await getConfig();
    await updateConfig(current);
    // Depois lê novamente
    return await getConfig();
  } catch (error) {
    logger.error('Erro ao recarregar configuração', error);
    throw error;
  }
}

/**
 * Reinicia o servidor da API.
 * 
 * ⚠️ ATENÇÃO: Isso encerrará o processo do servidor.
 * Se estiver usando nodemon ou similar, o servidor será reiniciado automaticamente.
 * 
 * @returns {Promise<{success: boolean, message: string, processManager?: string, hasProcessManager?: boolean, note?: string}>}
 */
export async function restartServer() {
  try {
    return await fetchJson('/server/restart', {
      method: 'POST',
    });
  } catch (error) {
    // O erro é esperado pois o servidor será encerrado
    logger.info('Servidor sendo reiniciado...', error);
    return { 
      success: true, 
      message: 'Servidor sendo reiniciado...',
      hasProcessManager: false,
      processManager: 'unknown'
    };
  }
}

/**
 * Verifica qual gerenciador de processo está sendo usado.
 * 
 * @returns {Promise<{success: boolean, processManager: string, hasProcessManager: boolean, details?: object}>}
 */
export async function getProcessManager() {
  try {
    return await fetchJson('/server/process-manager', {
      method: 'GET',
    });
  } catch (error) {
    logger.error('Erro ao verificar gerenciador de processo', error);
    return {
      success: false,
      processManager: 'unknown',
      hasProcessManager: false,
    };
  }
}

/**
 * Valida um token de provedor de IA.
 * 
 * @param {string} provider - Nome do provedor ('openai' ou 'anthropic')
 * @param {string} apiKey - Token/API Key a ser validado
 * @returns {Promise<{success: boolean, valid: boolean, error?: string}>}
 */
export async function validateProviderToken(provider, apiKey) {
  try {
    if (!provider || !apiKey) {
      throw new Error('Provider e apiKey são obrigatórios');
    }

    return await fetchJson('/config/validate-provider-token', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    });
  } catch (error) {
    logger.error('Erro ao validar token de provedor', error);
    throw error;
  }
}

/**
 * Valida automaticamente as credenciais de IA já salvas (criptografadas) para um tenant.
 * Não expõe a API key no frontend: o backend usa a key armazenada.
 *
 * @param {{ tenantId?: string|null, provider?: string|null }} params
 * @returns {Promise<{success: boolean, valid: boolean, provider?: string|null, error?: string|null}>}
 */
export async function validateTenantAiCredentials({ tenantId = null, provider = null } = {}) {
  try {
    const endpoint = tenantId
      ? `/tenants/${encodeURIComponent(tenantId)}/ai-credentials/test`
      : '/tenants/current/ai-credentials/test';

    return await fetchJson(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        ...(provider ? { provider } : {}),
      }),
    });
  } catch (error) {
    logger.error('Erro ao validar credenciais de IA do tenant', error);
    throw error;
  }
}

/**
 * Valida a conexão do Redis.
 * 
 * @param {string} redisUrl - URL do Redis a ser testada
 * @returns {Promise<{success: boolean, valid: boolean, error?: string}>}
 */
export async function validateRedisConnection(redisUrl) {
  try {
    if (!redisUrl) {
      throw new Error('URL do Redis é obrigatória');
    }

    return await fetchJson('/config/validate-redis', {
      method: 'POST',
      body: JSON.stringify({ redisUrl }),
    });
  } catch (error) {
    logger.error('Erro ao validar conexão do Redis', error);
    throw error;
  }
}

/**
 * Obtém a configuração de IA do tenant atual ou de um tenant específico.
 * Se tenantId for fornecido, usa /tenants/{tenantId}/ai-config (para super-admin).
 * Caso contrário, usa /tenants/current/ai-config (tenant autenticado).
 * 
 * @param {string} [tenantId] - ID do tenant (opcional, para super-admin)
 * @returns {Promise<{primary?: string, secondary?: string, configured?: boolean}>}
 */
export async function getTenantAiConfig(tenantId = null) {
  try {
    const endpoint = tenantId 
      ? `/tenants/${encodeURIComponent(tenantId)}/ai-config`
      : '/tenants/current/ai-config';
    
    const config = await fetchJson(endpoint, {
      method: 'GET',
    });
    // Garante que retorna no formato esperado (primary/secondary)
    return {
      primary: config.primary || config.provider || null,
      secondary: config.secondary || null,
      configured: !!(config.primary || config.provider),
      // Mantém campos antigos para compatibilidade
      ...config
    };
  } catch (error) {
    logger.error('Erro ao obter configuração de IA do tenant', error);
    // Se for 404, retorna configuração vazia (não configurado)
    if (error.status === 404) {
      return {
        primary: null,
        secondary: null,
        configured: false
      };
    }
    throw error;
  }
}

/**
 * Atualiza a configuração de IA do tenant atual ou de um tenant específico.
 * Se tenantId for fornecido, usa /tenants/{tenantId}/ai-config (para super-admin).
 * Caso contrário, usa /tenants/current/ai-config (tenant autenticado).
 * 
 * @param {Object} config - Configuração { primary: string, secondary?: string } ou { enabled, provider, model, temperature, maxTokens, quotaMonthly } para compatibilidade
 * @param {string} [tenantId] - ID do tenant (opcional, para super-admin)
 * @returns {Promise<Object>}
 */
export async function saveTenantAiConfig(config, tenantId = null) {
  try {
    if (!config || typeof config !== 'object') {
      throw new Error('config deve ser um objeto válido');
    }

    // Normaliza o payload: suporta primary/secondary ou formato antigo
    const normalizedConfig = {};
    
    // Prioridade: primary/secondary (novo formato)
    if (config.primary !== undefined) normalizedConfig.primary = config.primary;
    if (config.secondary !== undefined) normalizedConfig.secondary = config.secondary;
    
    // Compatibilidade com formato antigo
    if (config.enabled !== undefined) normalizedConfig.enabled = Boolean(config.enabled);
    if (config.provider !== undefined && !normalizedConfig.primary) normalizedConfig.provider = config.provider;
    if (config.model !== undefined) normalizedConfig.model = config.model;
    if (config.temperature !== undefined) normalizedConfig.temperature = Number(config.temperature);
    if (config.maxTokens !== undefined) normalizedConfig.maxTokens = Number(config.maxTokens);
    // Suporte ao formato snake_case usado no backend (tenantAIService)
    if (config.max_tokens !== undefined) normalizedConfig.max_tokens = Number(config.max_tokens);
    if (config.quotaMonthly !== undefined) normalizedConfig.quotaMonthly = Number(config.quotaMonthly);
    if (config.quota_monthly !== undefined) normalizedConfig.quota_monthly = Number(config.quota_monthly);

    const endpoint = tenantId 
      ? `/tenants/${encodeURIComponent(tenantId)}/ai-config`
      : '/tenants/current/ai-config';

    return await fetchJson(endpoint, {
      method: 'PUT',
      body: JSON.stringify(normalizedConfig),
    });
  } catch (error) {
    logger.error('Erro ao salvar configuração de IA do tenant', error);
    throw error;
  }
}

/**
 * Salva as credenciais de IA do tenant atual ou de um tenant específico.
 * Se tenantId for fornecido, usa /tenants/{tenantId}/ai-credentials (para super-admin).
 * Caso contrário, usa /tenants/current/ai-credentials (tenant autenticado).
 * A apiKey é criptografada no backend e nunca retornada.
 * 
 * @param {Object} credentials - { provider: string, apiKey: string }
 * @param {string} [tenantId] - ID do tenant (opcional, para super-admin)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function saveTenantAiCredentials(credentials, tenantId = null) {
  try {
    if (!credentials || typeof credentials !== 'object') {
      throw new Error('credentials deve ser um objeto válido');
    }
    if (!credentials.provider || typeof credentials.provider !== 'string') {
      throw new Error('provider é obrigatório');
    }
    if (!credentials.apiKey || typeof credentials.apiKey !== 'string') {
      throw new Error('apiKey é obrigatória');
    }

    const endpoint = tenantId 
      ? `/tenants/${encodeURIComponent(tenantId)}/ai-credentials`
      : '/tenants/current/ai-credentials';

    return await fetchJson(endpoint, {
      method: 'PUT',
      body: JSON.stringify({
        provider: credentials.provider,
        apiKey: credentials.apiKey
      }),
    });
  } catch (error) {
    logger.error('Erro ao salvar credenciais de IA do tenant', error);
    throw error;
  }
}


