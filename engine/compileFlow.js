/**
 * Módulo de compilação de fluxo.
 *
 * Objetivo:
 * - Receber um FlowDefinition "mutável" (tipicamente vindo de JSON bruto
 *   ou de um editor visual) e produzir um CompiledFlow:
 *   - profundamente imutável (Object.freeze recursivo)
 *   - sem QUALQUER referência compartilhada com o FlowDefinition original
 *
 * Importante:
 * - NÃO alteramos a lógica do fluxo: o conteúdo semântico
 *   (ids, tipos, next, configs) é preservado 1:1.
 * - Este módulo apenas reforça o contrato de imutabilidade e a
 *   segurança contra mutações acidentais em runtime.
 */

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').FlowNode} FlowNode
 * @typedef {import('./flowTypes').CompiledFlow} CompiledFlow
 */

/**
 * Clona profundamente um valor simples (objetos/arrays/valores primitivos)
 * sem preservar referências.
 *
 * Decisão importante:
 * - Usamos JSON.parse/stringify por simplicidade e performance
 *   suficientes para a maioria dos fluxos, assumindo que o FlowDefinition
 *   é composto apenas de dados serializáveis em JSON (sem funções,
 *   Maps, Sets, etc.).
 * - Isso reforça o contrato de "dados puros" para o fluxo.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Produz uma representação JSON canônica (com chaves ordenadas)
 * para garantir que o hash de versão seja estável independentemente
 * da ordem de definição das propriedades.
 *
 * @param {any} value
 * @returns {string}
 */
function toCanonicalJson(value) {
  function normalize(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);

    const result = {};
    const keys = Object.keys(v).sort();
    for (const k of keys) {
      result[k] = normalize(v[k]);
    }
    return result;
  }

  return JSON.stringify(normalize(value));
}

/**
 * Calcula um hash simples (djb2) a partir de uma string.
 * Suficiente para identificar de forma estável o conteúdo
 * de uma versão de fluxo.
 *
 * @param {string} str
 * @returns {string}
 */
function computeStringHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Converte para inteiro sem sinal e depois para hex
  return (hash >>> 0).toString(16);
}

/**
 * Aplica Object.freeze de forma recursiva em toda a árvore do objeto.
 *
 * @param {any} obj
 * @returns {any}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Congela propriedades primeiro
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = obj[prop];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  });

  return Object.freeze(obj);
}

/**
 * Compila um FlowDefinition em um CompiledFlow profundamente imutável.
 *
 * Garantias:
 * - Nenhuma referência ao objeto original é preservada:
 *   - fazemos deep clone antes de congelar.
 * - A estrutura lógica do fluxo não é alterada:
 *   - não adicionamos, removemos ou reinterpretamos campos.
 * - O resultado é seguro para ser reutilizado em múltiplas sessões
 *   e por múltiplas chamadas da engine sem risco de mutação.
 *
 * @param {FlowDefinition} flow
 * @returns {CompiledFlow}
 */
function compileFlow(flow) {
  if (!flow || typeof flow !== 'object') {
    throw new Error('compileFlow: flow inválido (esperado FlowDefinition)');
  }

  // Clonamos profundamente para garantir ausência de referências
  // compartilhadas com o objeto de entrada.
  const cloned = deepClonePlain(flow);

  // Geramos um hash estável do conteúdo da versão, ignorando
  // diferenças de ordenação de chaves.
  const canonical = toCanonicalJson({
    tenantId: cloned.tenantId,
    id: cloned.id,
    version: cloned.version,
    nodes: cloned.nodes,
    metadata: cloned.metadata,
  });
  const versionHash = computeStringHash(canonical);

  // Anexamos o hash ao objeto clonado antes de congelar.
  cloned.versionHash = versionHash;

  // Aplicamos Object.freeze recursivo em toda a árvore.
  const frozen = deepFreeze(cloned);

  /** @type {CompiledFlow} */
  const compiled = frozen;

  return compiled;
}

/**
 * Constrói uma chave de cache estável para um fluxo compilado
 * em ambiente multi-tenant.
 *
 * Recomendação:
 * - Pode ser usada em caches in-memory ou distribuídos para
 *   armazenar o resultado de compileFlow por tenant + id + versão.
 *
 * @param {string} tenantId
 * @param {string} flowId
 * @param {number} version
 * @returns {string}
 */
function buildCompiledFlowCacheKey(tenantId, flowId, version) {
  return `tenant:${tenantId}:flow:${flowId}:v:${version}`;
}

module.exports = {
  compileFlow,
  // Exportamos helpers para facilitar testes, se necessário.
  _internal: {
    deepClonePlain,
    deepFreeze,
    toCanonicalJson,
    computeStringHash,
    buildCompiledFlowCacheKey,
  },
};


