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
  return new Date().toISOString();
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
    id: `${sessionId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
 * @param {import('./flowTypes').FlowDefinition} flow
 * @param {string} nodeId
 * @returns {import('./flowTypes').FlowNode|null}
 */
function findNode(flow, nodeId) {
  const node = flow.nodes.find((n) => n.id === nodeId);
  return node || null;
}

module.exports = {
  nowIso,
  createEngineEvent,
  findNode,
};


