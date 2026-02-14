/**
 * Nó "merge"
 *
 * No-op estrutural usado para convergência de múltiplas entradas.
 * Não emite mensagens e não altera variáveis; apenas encaminha para o próximo nó
 * via `node.next` (resolução final é feita pelo runner).
 */

const { createEngineEvent } = require('../utils');

function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

/**
 * @param {import('../flowTypes').FlowNode} node
 * @param {import('../flowTypes').ConversationState} state
 * @returns {Promise<import('../flowTypes').EngineStepOutput>}
 */
async function mergeNodeHandler(node, state) {
  const nextState = cloneState(state);

  return {
    nextState,
    events: [
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'MERGE_PASSTHROUGH',
        payload: {
          next: node.next ?? null,
        },
      }),
    ],
    output: null,
  };
}

module.exports = {
  mergeNodeHandler,
};

