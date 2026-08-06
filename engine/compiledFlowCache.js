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
 * - Capacidade limitada com eviction FIFO:
 *   - O cache tem um teto de entradas (MAX_CACHE_ENTRIES); ao exceder,
 *     a entrada mais antiga (ordem de inserção do Map) é removida.
 * - Invalidação explícita por fluxo:
 *   - `invalidateCompiledFlow(tenantId, flowId)` remove TODAS as versões
 *     cacheadas de um fluxo. Deve ser chamada pelos caminhos de mutação
 *     de flow (update/delete), pois o PUT de flow preserva `version` e a
 *     chave tenant+id+version não mudaria — sem invalidação, a versão
 *     antiga continuaria executando até restart.
 *   - Não há invalidação automática por tempo.
 */

const { compileFlow, _internal } = require('./compileFlow');

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').CompiledFlow} CompiledFlow
 */

// Teto de entradas do cache (eviction FIFO pela ordem de inserção do Map).
const MAX_CACHE_ENTRIES = 200;

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
    setCacheEntry(key, compiled);
  }
}

/**
 * Armazena uma entrada aplicando o teto do cache (eviction FIFO).
 *
 * @param {string} key
 * @param {CompiledFlow} compiled
 */
function setCacheEntry(key, compiled) {
  cache.set(key, compiled);
  while (cache.size > MAX_CACHE_ENTRIES) {
    // Map preserva ordem de inserção: a primeira chave é a mais antiga.
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/**
 * Invalida (remove) TODAS as versões cacheadas de um fluxo.
 *
 * Deve ser chamada quando um fluxo é atualizado ou removido, pois a
 * chave de cache (tenant+id+version) não muda quando o update preserva
 * `flow.version`.
 *
 * @param {string} tenantId
 * @param {string} flowId
 */
function invalidateCompiledFlow(tenantId, flowId) {
  const prefix = `tenant:${tenantId}:flow:${flowId}:v:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
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

  // Hardening: se o fluxo foi gerado por IA, revalida antes de compilar/executar.
  // (Execução só ocorre após aprovação, mas ainda assim revalidamos como blindagem final.)
  // A revalidação roda apenas em cache MISS: o CompiledFlow cacheado é
  // profundamente congelado (compileFlow → deepFreeze), portanto não pode ser
  // mutado por referência depois de cacheado — revalidar a cada hit era custo
  // redundante por chamada.
  const isAiFlow = flow?.metadata?.generatedBy === 'ai' || flow?.metadata?.generated === true;
  if (isAiFlow) {
    const { validateFlow } = require('./validator');
    const res = validateFlow(flow);
    if (!res || res.valid !== true) {
      const err = new Error('getOrCompileFlow: fluxo de IA inválido para execução (revalidação falhou)');
      // @ts-ignore
      err.code = 'AI_FLOW_INVALID_AT_EXECUTION';
      // @ts-ignore
      err.details = { errors: res?.errors || [] };
      throw err;
    }
  }

  const compiled = compileFlow(flow);
  setCacheEntry(key, compiled);
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
  invalidateCompiledFlow,
  clearCompiledFlowCache,
  MAX_CACHE_ENTRIES,
};


