const rng = require('./shared/random');
const clock = require('./shared/clock');
/**
 * Funções utilitárias genéricas usadas pela engine.
 * Mantidas em módulo separado para evitar duplicação
 * e facilitar testes unitários.
 */

/**
 * Gera um timestamp ISO.
 * Separado para facilitar mocks em testes.
 *
 * @returns {string}
 */
function nowIso() {
  return clock.nowIso();
}

/**
 * Cria um evento de engine com campos padrão.
 * O chamador pode sobrescrever qualquer campo via payload extra.
 *
 * @param {Object} base
 * @param {string} base.sessionId
 * @param {string} base.flowId
 * @param {string|null} [base.nodeId]
 * @param {string} base.type
 * @param {Object<string, any>} [base.payload]
 * @returns {import('./flowTypes').EngineEvent}
 */
function createEngineEvent(base) {
  const { sessionId, flowId, nodeId = null, type, payload } = base;

  return {
    // Importante: o ID pode (e deve) ser sobrescrito pelo chamador
    // se ele tiver uma estratégia global de geração de IDs (ex: UUID).
    id: `${sessionId}-${clock.nowMs()}-${rng.random().toString(16).slice(2)}`,
    timestamp: nowIso(),
    sessionId,
    flowId,
    nodeId,
    type,
    payload: payload || {},
  };
}

/**
 * Localiza um nó por ID em um fluxo.
 *
 * Performance:
 * - Se o fluxo é um CompiledFlow (possui `nodeIndex` construído em
 *   compileFlow), o lookup é O(1) via Map.
 * - Flows "crus" (simulador/testes) fazem fallback para a busca linear
 *   original, com a mesma semântica de igualdade estrita.
 *
 * @param {import('./flowTypes').FlowDefinition} flow
 * @param {string} nodeId
 * @returns {import('./flowTypes').FlowNode|null}
 */
function findNode(flow, nodeId) {
  if (!flow) return null;
  const index = flow.nodeIndex;
  if (index instanceof Map) {
    const node = index.get(nodeId);
    return node || null;
  }
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const node = nodes.find((n) => n.id === nodeId);
  return node || null;
}

/**
 * Normaliza o campo "next" de um nó.
 * Suporta tanto string (conexão única) quanto array (múltiplas conexões).
 * Para execução, retorna a primeira conexão quando há múltiplas.
 *
 * @param {string|string[]|null|undefined} next
 * @returns {string|null}
 */
function normalizeNext(next) {
  if (!next) return null;
  if (typeof next === 'string') return next;
  if (Array.isArray(next) && next.length > 0) return next[0];
  return null;
}

/**
 * Extrai todas as conexões do campo "next" de um nó.
 * Suporta tanto string (conexão única) quanto array (múltiplas conexões).
 *
 * @param {string|string[]|null|undefined} next
 * @returns {string[]}
 */
function getAllNextConnections(next) {
  if (!next) return [];
  if (typeof next === 'string') return [next];
  if (Array.isArray(next)) return next.filter((id) => typeof id === 'string');
  return [];
}

module.exports = {
  nowIso,
  createEngineEvent,
  findNode,
  normalizeNext,
  getAllNextConnections,
};


