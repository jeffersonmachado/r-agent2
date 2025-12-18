/**
 * Cache in-memory de CompiledFlow.
 *
 * Requisitos atendidos:
 * - Cache por tenant + versão:
 *   - Chave: tenantId + flowId + version (via buildCompiledFlowCacheKey).
 * - Cache imutável:
 *   - Apenas armazena resultados de compileFlow, que já são
 *     profundamente congelados (Object.freeze).
 * - Safe para concorrência:
 *   - Node.js é single-thread no mesmo processo; ao usar apenas
 *     estruturas imutáveis e Map interno, leitura concorrente é segura.
 *   - Nenhuma mutação é feita sobre os objetos retornados.
 * - Cache invalidado apenas por nova versão:
 *   - Este módulo NUNCA remove nem sobrescreve entradas de uma
 *     mesma versão; novas versões geram novas chaves.
 *   - Opcionalmente, o chamador pode limpar o cache inteiro se
 *     necessário, mas não há invalidação automática por tempo.
 */

const { compileFlow, _internal } = require('./compileFlow');

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').CompiledFlow} CompiledFlow
 */

// Mapa interno de cache: chave -> CompiledFlow
/** @type {Map<string, CompiledFlow>} */
const cache = new Map();

/**
 * Gera a chave de cache para um fluxo.
 *
 * @param {string} tenantId
 * @param {string} flowId
 * @param {number} version
 * @returns {string}
 */
function makeKey(tenantId, flowId, version) {
  return _internal.buildCompiledFlowCacheKey(tenantId, flowId, version);
}

/**
 * Obtém um CompiledFlow do cache, se existir.
 *
 * @param {string} tenantId
 * @param {string} flowId
 * @param {number} version
 * @returns {CompiledFlow|null}
 */
function getCompiledFlowFromCache(tenantId, flowId, version) {
  const key = makeKey(tenantId, flowId, version);
  const value = cache.get(key);
  return value || null;
}

/**
 * Armazena um CompiledFlow no cache.
 *
 * Importante:
 * - NÃO sobrescrevemos se a chave já existir, para garantir que
 *   uma mesma versão não seja trocada em runtime.
 *
 * @param {CompiledFlow} compiled
 */
function putCompiledFlowInCache(compiled) {
  const key = makeKey(compiled.tenantId, compiled.id, compiled.version);
  if (!cache.has(key)) {
    cache.set(key, compiled);
  }
}

/**
 * Obtém um CompiledFlow se já estiver em cache ou o compila,
 * armazena e devolve.
 *
 * Decisões:
 * - Evita recompilações desnecessárias para o mesmo tenant/fluxo/versão.
 * - Não tenta resolver condições de corrida complexas (como múltiplos
 *   compiladores paralelos); em Node.js, isso normalmente não é um
 *   problema, e o custo de uma recompilação eventual é baixo.
 *
 * @param {FlowDefinition} flow
 * @returns {CompiledFlow}
 */
function getOrCompileFlow(flow) {
  if (!flow || typeof flow !== 'object') {
    throw new Error('getOrCompileFlow: flow inválido');
  }

  const key = makeKey(flow.tenantId, flow.id, flow.version);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const compiled = compileFlow(flow);
  cache.set(key, compiled);
  return compiled;
}

/**
 * Limpa TODO o cache (usado apenas em testes ou ferramentas).
 * Não deve ser usado para "invalidação por nova versão", pois
 * novas versões usam chaves diferentes.
 */
function clearCompiledFlowCache() {
  cache.clear();
}

module.exports = {
  getCompiledFlowFromCache,
  putCompiledFlowInCache,
  getOrCompileFlow,
  clearCompiledFlowCache,
};


