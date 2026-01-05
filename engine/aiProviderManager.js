/**
 * Gerenciador de múltiplos providers de IA.
 *
 * Regras:
 * - Suporta múltiplos providers (ex.: "openai", "local", "fallback").
 * - Seleção por tenant:
 *   - Cada tenant pode ter um provider principal e um fallback.
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
 * - primary: id do provider principal (ex.: "openai").
 * - fallback: id do provider de fallback (ex.: "local" ou "stub").
 *
 * @typedef {Object} TenantAiConfig
 * @property {string} primary
 * @property {string} [fallback]
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
 * - "local-llm"
 * - "fallback-static"
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
    fallback: config.fallback,
  });
}

/**
 * Obtém o provider configurado para um tenant, já com fallback
 * aplicado (se houver).
 *
 * Decisão:
 * - Se houver fallback, retornamos um "provider composto" que:
 *   - Tenta o provider primário.
 *   - Em caso de erro, tenta o fallback.
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
    fallback: cfg.fallback,
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

  const fallback = cfg.fallback ? providerRegistry.get(cfg.fallback) : null;

  if (!fallback) {
    log.debug('ℹ️ getAiProviderForTenant: Sem fallback configurado, retornando provider primário', {
      tenantId,
      primaryId: cfg.primary,
    });
    return primary;
  }

  log.debug('✅ getAiProviderForTenant: Provider composto (com fallback)', {
    tenantId,
    primaryId: cfg.primary,
    fallbackId: cfg.fallback,
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
        // CRÍTICO: Log como erro ao invés de warning - fallback não deve ser silencioso
        log.error('❌ Provider composto: Provider primário falhou, usando fallback', {
          tenantId,
          primaryId: cfg.primary,
          fallbackId: cfg.fallback,
          error: err.message,
          errorStack: err.stack,
          severity: 'HIGH',
          alert: 'AI_PROVIDER_FALLBACK_USED',
        });
        
        // Registra no monitoramento de fallbacks
        try {
          const { recordFallback, FALLBACK_TYPES } = require('./fallbackMonitor');
          recordFallback(FALLBACK_TYPES.AI_PROVIDER_FALLBACK, {
            tenantId,
            primaryProvider: cfg.primary,
            fallbackProvider: cfg.fallback,
            errorType: err.name || 'UnknownError',
            sessionId: context?.sessionId,
          });
        } catch (monitorError) {
          // Não falha se monitoramento não estiver disponível
          log.debug('Não foi possível registrar métrica de fallback', { error: monitorError.message });
        }
        
        // Tentamos o fallback, mas sem mudar a semântica de fluxo:
        // qualquer erro ainda será tratado no nível do nó de IA.
        if (!fallback) {
          log.error('❌ Provider composto: Fallback não disponível', {
            tenantId,
            fallbackId: cfg.fallback,
            severity: 'CRITICAL',
            alert: 'AI_PROVIDER_FALLBACK_UNAVAILABLE',
          });
          throw err;
        }
        const fallbackResult = await fallback.generate(prompt, context);
        // Log como warning - fallback funcionou mas é um sinal de problema
        log.warn('⚠️ Provider composto: Fallback funcionou (problema no provider primário deve ser investigado)', {
          tenantId,
          fallbackId: cfg.fallback,
          primaryId: cfg.primary,
          hasText: !!fallbackResult?.text,
          severity: 'MEDIUM',
          alert: 'AI_PROVIDER_FALLBACK_SUCCESS',
        });
        return fallbackResult;
      }
    },
  };

  return composite;
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
  clearAiProviderConfig,
};


