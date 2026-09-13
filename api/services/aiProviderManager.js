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

// engine → api (acesso a logger/config) é best-effort
const logger = require('../utils/logger');
const { classifyProviderError, PROVIDER_ERROR_CATEGORY } = require('../../engine/aiControlPlaneResilience');
let config = null;
try {
  // eslint-disable-next-line global-require
  config = require('../utils/config');
} catch {
  // Se não conseguir carregar config, mantém postura segura (ver getAiProviderForTenant).
  config = null;
}

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

// Memoização do provider resolvido por tenant (inclui null = sem provider).
// Invalidada em setTenantAiConfig (por tenant), registerAiProvider (toda a
// memo, pois a instância do provider pode ter sido substituída) e
// clearAiProviderConfig.
/** @type {Map<string, AiProvider|null>} */
const tenantProviderCache = new Map();

// Timeout padrão da chamada de IA (configurável via ENGINE_AI_TIMEOUT_MS).
// Sem timeout, um provider pendurado segurava a mensagem indefinidamente.
const DEFAULT_AI_TIMEOUT_MS = 30000;

function resolveAiTimeoutMs() {
  const raw = Number(process.env.ENGINE_AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_TIMEOUT_MS;
}

/**
 * Constrói um "provider composto" que tenta cada provider da lista em ordem.
 *
 * Semântica:
 * - Cada entry tem `{ id, generate }` (generate já vinculado à instância).
 * - O primeiro provider que responder com sucesso vence.
 * - Em falha, tenta o próximo (registrando warning; erro de "não configurado"
 *   para o tenant é apenas debug, pois é esperado no roteamento engine-wide).
 * - Se todos falharem, lança o último erro.
 *
 * @param {string} normalizedTenantId
 * @param {string} tenantId - tenantId original (para logs)
 * @param {Array<{id: string, generate: Function}>} providerList
 * @returns {AiProvider}
 */
function buildCompositeProvider(normalizedTenantId, tenantId, providerList) {
  const timeoutMs = resolveAiTimeoutMs();
  const entries = providerList.map((entry) => ({
    id: entry.id,
    generate: withAiTimeout(entry.generate, timeoutMs),
  }));

  return {
    async generate(prompt, context) {
      let lastError = null;
      for (const entry of entries) {
        try {
          logger.debug('🔄 Roteamento engine: tentando provider', {
            tenantId: normalizedTenantId,
            providerId: entry.id,
          });
          const result = await entry.generate(prompt, context);
          logger.debug('✅ Roteamento engine: provider funcionou', {
            tenantId,
            providerId: entry.id,
            hasText: !!result?.text,
          });
          return result;
        } catch (err) {
          lastError = err;
          const classification = classifyProviderError(err);
          const isHardBlock =
            classification.category === PROVIDER_ERROR_CATEGORY.POLICY_DENIAL
            || classification.category === PROVIDER_ERROR_CATEGORY.RETIRED_MODEL
            || classification.category === PROVIDER_ERROR_CATEGORY.BUDGET_BLOCK;
          const notConfigured = err && err.code === 'AI_PROVIDER_NOT_CONFIGURED';
          const log = notConfigured ? logger.debug : logger.warn;
          log.call(logger, '⚠️ Roteamento engine: provider falhou', {
            tenantId: normalizedTenantId,
            providerId: entry.id,
            code: err?.code || null,
            error: err?.message || String(err),
            category: classification.category,
          });
          // Bloqueios duros (policy denial, modelo aposentado, budget) não
          // cascateiam para outro provider — param imediatamente.
          if (isHardBlock) {
            throw err;
          }
        }
      }
      throw lastError || new Error(`Nenhum provider de IA disponível para o tenant: ${normalizedTenantId}`);
    },
  };
}

/**
 * Envolve uma função generate com timeout explícito (erro code='ai_timeout').
 *
 * @param {(prompt: string, context: any) => Promise<any>} generateFn
 * @param {number} timeoutMs
 * @returns {(prompt: string, context: any) => Promise<any>}
 */
function withAiTimeout(generateFn, timeoutMs) {
  return async function generateWithTimeout(prompt, context) {
    let timer = null;
    try {
      return await Promise.race([
        generateFn(prompt, context),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const err = new Error(`ai_timeout: provider de IA excedeu ${timeoutMs}ms`);
            // @ts-ignore
            err.code = 'ai_timeout';
            reject(err);
          }, timeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

function normalizeId(value) {
  if (typeof value !== 'string') return '';
  try {
    return value.trim().toLowerCase();
  } catch {
    return '';
  }
}

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
  const providerId = normalizeId(id);
  if (!providerId || typeof provider !== 'object' || typeof provider.generate !== 'function') {
    throw new Error('registerAiProvider: provider inválido');
  }
  providerRegistry.set(providerId, provider);
  // A instância do provider pode ter sido substituída: invalida toda a memo.
  tenantProviderCache.clear();
}

/**
 * Configura os providers de IA para um tenant específico.
 *
 * @param {string} tenantId
 * @param {TenantAiConfig} config
 */
function setTenantAiConfig(tenantId, config) {
  const normalizedTenantId = normalizeId(tenantId);
  const primary = normalizeId(config?.primary);
  const secondary = normalizeId(config?.secondary);

  if (!normalizedTenantId) {
    throw new Error('setTenantAiConfig: tenantId é obrigatório');
  }
  if (!primary) {
    throw new Error('setTenantAiConfig: config.primary é obrigatório');
  }
  if (secondary && secondary === primary) {
    throw new Error('setTenantAiConfig: config.secondary deve ser diferente de config.primary');
  }

  tenantConfig.set(normalizedTenantId, {
    primary,
    secondary: secondary || undefined,
  });
  tenantProviderCache.delete(normalizedTenantId);
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
  const normalizedTenantId = normalizeId(tenantId);
  if (!normalizedTenantId) {
    return null;
  }

  // Provider resolvido é memoizado por tenant (invalidado quando a config
  // ou o registry de providers muda — ver setTenantAiConfig/registerAiProvider).
  if (tenantProviderCache.has(normalizedTenantId)) {
    return tenantProviderCache.get(normalizedTenantId);
  }

  const resolved = resolveAiProviderForTenant(normalizedTenantId, tenantId);
  tenantProviderCache.set(normalizedTenantId, resolved);
  return resolved;
}

/**
 * Resolve (sem cache) o provider de um tenant, aplicando provider
 * secundário configurado e timeout explícito em cada chamada de IA.
 *
 * @param {string} normalizedTenantId
 * @param {string} tenantId - tenantId original (para logs)
 * @returns {AiProvider|null}
 */
function resolveAiProviderForTenant(normalizedTenantId, tenantId) {
  // Fallback "provider secundário" deve ser explícito e configurável.
  // Default: false (não usar secondary automaticamente).
  let allowSecondaryFallback = false;
  try {
    allowSecondaryFallback = !!(config && config.get && config.get('fallbacks.aiProviderSecondary', false) === true);
  } catch {
    // Se não conseguir ler config, mantém postura segura: não usa secondary por padrão.
    allowSecondaryFallback = false;
  }

  logger.debug('🔍 getAiProviderForTenant: Buscando provider', { tenantId: normalizedTenantId });
  
  const cfg = tenantConfig.get(normalizedTenantId);
  if (!cfg) {
    // Sem configuração explícita por tenant: a engine decide, roteando por
    // TODOS os providers registrados. Cada provider falha rápido quando o
    // tenant não possui credencial (code AI_PROVIDER_NOT_CONFIGURED).
    const registeredIds = Array.from(providerRegistry.keys());
    if (registeredIds.length === 0) {
      logger.warn('⚠️ getAiProviderForTenant: Nenhum provider registrado', { tenantId });
      return null;
    }
    logger.debug('ℹ️ getAiProviderForTenant: Sem config por tenant — roteando por todos os providers registrados', {
      tenantId,
      providers: registeredIds,
    });
    return buildCompositeProvider(
      normalizedTenantId,
      tenantId,
      registeredIds.map((id) => ({
        id,
        generate: providerRegistry.get(id).generate.bind(providerRegistry.get(id)),
      })),
    );
  }

  logger.debug('✅ getAiProviderForTenant: Configuração encontrada', {
    tenantId,
    primary: cfg.primary,
    secondary: cfg.secondary,
  });

  const primary = providerRegistry.get(cfg.primary);
  if (!primary) {
    logger.error('❌ getAiProviderForTenant: Provider primário não encontrado', {
      tenantId,
      primaryId: cfg.primary,
      providersDisponiveis: Array.from(providerRegistry.keys()),
    });
    return null;
  }

  logger.debug('✅ getAiProviderForTenant: Provider primário encontrado', {
    tenantId,
    primaryId: cfg.primary,
    hasGenerate: typeof primary.generate === 'function',
  });

  const secondary = cfg.secondary ? providerRegistry.get(cfg.secondary) : null;
  const timeoutMs = resolveAiTimeoutMs();

  if (!allowSecondaryFallback || !secondary) {
    logger.debug('ℹ️ getAiProviderForTenant: Sem provider secundário configurado, retornando provider primário', {
      tenantId,
      primaryId: cfg.primary,
      allowSecondaryFallback,
    });
    return { generate: withAiTimeout(primary.generate.bind(primary), timeoutMs) };
  }

  logger.debug('✅ getAiProviderForTenant: Provider composto (com secundário)', {
    tenantId,
    primaryId: cfg.primary,
    secondaryId: cfg.secondary,
  });

  const primaryGenerate = withAiTimeout(primary.generate.bind(primary), timeoutMs);
  const secondaryGenerate = withAiTimeout(secondary.generate.bind(secondary), timeoutMs);

  /** @type {AiProvider} */
  const composite = {
    async generate(prompt, context) {
      try {
        logger.debug('🔄 Provider composto: Tentando provider primário', {
          tenantId: normalizedTenantId,
          primaryId: cfg.primary,
        });
        const result = await primaryGenerate(prompt, context);
        logger.debug('✅ Provider composto: Provider primário funcionou', {
          tenantId,
          primaryId: cfg.primary,
          hasText: !!result?.text,
        });
        return result;
      } catch (err) {
        // Log como warning - provider secundário sendo usado
        logger.warn('⚠️ Provider composto: Provider primário falhou, usando provider secundário', {
          tenantId: normalizedTenantId,
          primaryId: cfg.primary,
          secondaryId: cfg.secondary,
          error: err.message,
          errorStack: err.stack,
        });
        
        // Tentamos o provider secundário, mas sem mudar a semântica de fluxo:
        // qualquer erro ainda será tratado no nível do nó de IA.
        if (!secondary) {
          logger.error('❌ Provider composto: Provider secundário não disponível', {
            tenantId: normalizedTenantId,
            secondaryId: cfg.secondary,
          });
          throw err;
        }
        const secondaryResult = await secondaryGenerate(prompt, context);
        logger.info('✅ Provider composto: Provider secundário funcionou', {
          tenantId: normalizedTenantId,
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
  return providerRegistry.has(normalizeId(providerId));
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
  tenantProviderCache.clear();
}

module.exports = {
  registerAiProvider,
  setTenantAiConfig,
  getAiProviderForTenant,
  isProviderRegistered,
  getRegisteredProviderIds,
  clearAiProviderConfig,
};


