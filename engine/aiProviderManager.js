/**
 * Gerenciador de múltiplos providers de IA.
 *
 * Regras:
 * - Suporta múltiplos providers (ex.: "openai", "anthropic").
 * - Seleção por tenant:
 *   - Cada tenant pode ter um provider primário e um secundário.
 * - IA nunca controla fluxo:
 *   - Este módulo apenas seleciona QUAL provider será chamado.
 *   - A decisão de fluxo continua no grafo/routers, nunca no modelo.
 *
 * Importante:
 * - Este módulo NÃO importa SDKs específicos (OpenAI, etc.).
 *   A aplicação registra instâncias concretas que implementam
 *   a interface AiProvider definida em aiNode.js.
 */

/**
 * @typedef {import('./nodes/aiNode').AiProvider} AiProvider
 */

/**
 * Configuração de provider de IA por tenant.
 *
 * - primary: id do provider primário (ex.: "openai").
 * - secondary: id do provider secundário (ex.: "anthropic").
 *
 * @typedef {Object} TenantAiConfig
 * @property {string} primary
 * @property {string} [secondary]
 */

/** @type {Map<string, AiProvider>} */
const providerRegistry = new Map();

/** @type {Map<string, TenantAiConfig>} */
const tenantConfig = new Map();

/**
 * Registra um provider de IA globalmente.
 *
 * Exemplo de ids:
 * - "openai"
 * - "anthropic"
 *
 * @param {string} id
 * @param {AiProvider} provider
 */
function registerAiProvider(id, provider) {
  if (!id || typeof provider !== 'object' || typeof provider.generate !== 'function') {
    throw new Error('registerAiProvider: provider inválido');
  }
  providerRegistry.set(id, provider);
}

/**
 * Configura os providers de IA para um tenant específico.
 *
 * @param {string} tenantId
 * @param {TenantAiConfig} config
 */
function setTenantAiConfig(tenantId, config) {
  if (!config || !config.primary) {
    throw new Error('setTenantAiConfig: config.primary é obrigatório');
  }
  tenantConfig.set(tenantId, {
    primary: config.primary,
    secondary: config.secondary,
  });
}

/**
 * Obtém o provider configurado para um tenant, já com provider secundário
 * aplicado (se houver).
 *
 * Decisão:
 * - Se houver provider secundário, retornamos um "provider composto" que:
 *   - Tenta o provider primário.
 *   - Em caso de erro, tenta o provider secundário.
 * - Erros de ambos continuam sendo tratados no aiNodeHandler
 *   como AI_ERROR, sem afetar o fluxo.
 *
 * @param {string} tenantId
 * @returns {AiProvider|null}
 */
function getAiProviderForTenant(tenantId) {
  // Logger simples para o engine
  const log = {
    debug: (msg, data) => {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`[DEBUG] ${msg}`, data || '');
      }
    },
    warn: (msg, data) => {
      // eslint-disable-next-line no-console
      console.warn(`[WARN] ${msg}`, data || '');
    },
    error: (msg, data) => {
      // eslint-disable-next-line no-console
      console.error(`[ERROR] ${msg}`, data || '');
    },
  };

  log.debug('🔍 getAiProviderForTenant: Buscando provider', { tenantId });
  
  const cfg = tenantConfig.get(tenantId);
  if (!cfg) {
    log.warn('⚠️ getAiProviderForTenant: Nenhuma configuração encontrada para tenant', { tenantId });
    log.debug('📋 Tenants configurados', { tenants: Array.from(tenantConfig.keys()) });
    return null;
  }

  log.debug('✅ getAiProviderForTenant: Configuração encontrada', {
    tenantId,
    primary: cfg.primary,
    secondary: cfg.secondary,
  });

  const primary = providerRegistry.get(cfg.primary);
  if (!primary) {
    log.error('❌ getAiProviderForTenant: Provider primário não encontrado', {
      tenantId,
      primaryId: cfg.primary,
      providersDisponiveis: Array.from(providerRegistry.keys()),
    });
    return null;
  }

  log.debug('✅ getAiProviderForTenant: Provider primário encontrado', {
    tenantId,
    primaryId: cfg.primary,
    hasGenerate: typeof primary.generate === 'function',
  });

  const secondary = cfg.secondary ? providerRegistry.get(cfg.secondary) : null;

  if (!secondary) {
    log.debug('ℹ️ getAiProviderForTenant: Sem provider secundário configurado, retornando provider primário', {
      tenantId,
      primaryId: cfg.primary,
    });
    return primary;
  }

  log.debug('✅ getAiProviderForTenant: Provider composto (com secundário)', {
    tenantId,
    primaryId: cfg.primary,
    secondaryId: cfg.secondary,
  });

  /** @type {AiProvider} */
  const composite = {
    async generate(prompt, context) {
      try {
        log.debug('🔄 Provider composto: Tentando provider primário', {
          tenantId,
          primaryId: cfg.primary,
        });
        const result = await primary.generate(prompt, context);
        log.debug('✅ Provider composto: Provider primário funcionou', {
          tenantId,
          primaryId: cfg.primary,
          hasText: !!result?.text,
        });
        return result;
      } catch (err) {
        // Log como warning - provider secundário sendo usado
        log.warn('⚠️ Provider composto: Provider primário falhou, usando provider secundário', {
          tenantId,
          primaryId: cfg.primary,
          secondaryId: cfg.secondary,
          error: err.message,
          errorStack: err.stack,
        });
        
        // Tentamos o provider secundário, mas sem mudar a semântica de fluxo:
        // qualquer erro ainda será tratado no nível do nó de IA.
        if (!secondary) {
          log.error('❌ Provider composto: Provider secundário não disponível', {
            tenantId,
            secondaryId: cfg.secondary,
          });
          throw err;
        }
        const secondaryResult = await secondary.generate(prompt, context);
        log.info('✅ Provider composto: Provider secundário funcionou', {
          tenantId,
          secondaryId: cfg.secondary,
          primaryId: cfg.primary,
          hasText: !!secondaryResult?.text,
        });
        return secondaryResult;
      }
    },
  };

  return composite;
}

/**
 * Verifica se um provider está registrado.
 * 
 * @param {string} providerId
 * @returns {boolean}
 */
function isProviderRegistered(providerId) {
  return providerRegistry.has(providerId);
}

/**
 * Obtém a lista de IDs de providers registrados.
 * 
 * @returns {string[]}
 */
function getRegisteredProviderIds() {
  return Array.from(providerRegistry.keys());
}

/**
 * Limpa registro e configurações (útil em testes).
 */
function clearAiProviderConfig() {
  providerRegistry.clear();
  tenantConfig.clear();
}

module.exports = {
  registerAiProvider,
  setTenantAiConfig,
  getAiProviderForTenant,
  isProviderRegistered,
  getRegisteredProviderIds,
  clearAiProviderConfig,
};


