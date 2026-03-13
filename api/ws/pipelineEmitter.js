const { emitEvent } = require('../services/websocketService');

/**
 * Adapter "socket.io-like" para uso no helper emitPipelineStage.
 * Mantém a semântica: ws.to(executionId).emit(event, payload)
 *
 * Observação:
 * - O transporte é WebSocket (ws) com roteamento por tenant + executionId (subscription).
 */
function createPipelineWs({ tenantId } = {}) {
  const t = (tenantId && String(tenantId).trim()) ? String(tenantId).trim() : null;

  return {
    to: (executionId) => {
      const execId = (executionId && String(executionId).trim()) ? String(executionId).trim() : null;
      return {
        emit: (event, payload) => {
          if (!t) return;
          if (!execId) return;
          emitEvent(event, payload, { tenantId: t, executionId: execId });
        },
      };
    },
  };
}

module.exports = { createPipelineWs };

