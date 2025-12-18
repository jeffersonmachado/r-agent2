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
  const cfg = tenantConfig.get(tenantId);
  if (!cfg) return null;

  const primary = providerRegistry.get(cfg.primary);
  if (!primary) return null;

  const fallback = cfg.fallback ? providerRegistry.get(cfg.fallback) : null;

  if (!fallback) {
    return primary;
  }

  /** @type {AiProvider} */
  const composite = {
    async generate(prompt, context) {
      try {
        return await primary.generate(prompt, context);
      } catch (err) {
        // Tentamos o fallback, mas sem mudar a semântica de fluxo:
        // qualquer erro ainda será tratado no nível do nó de IA.
        if (!fallback) throw err;
        return fallback.generate(prompt, context);
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


