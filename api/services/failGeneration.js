const { updateStatus } = require('./pipelineExecutionContext');
const { GenerationFailureReasons } = require('../constants/GenerationFailureReasons');
const { createPipelineWs } = require('../ws/pipelineEmitter');
const { emitPipelineStage } = require('../ws/emitPipelineStage');

function safeToString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(error, fallback = '') {
  let message;

  try {
    message = error?.message;
  } catch (_) {
    message = null;
  }

  if (message !== null && message !== undefined) return safeToString(message, fallback);
  return safeToString(error, fallback);
}

/**
 * Falha terminal centralizada:
 * - atualiza estado interno via updateStatus(execution, 'failed', metadata)
 * - relança o erro original
 *
 * NUNCA emite websocket diretamente aqui.
 * O websocket é emitido dentro de updateStatus(...) via `pipeline.status`.
 */
async function failGeneration({ execution, reason = GenerationFailureReasons.UNKNOWN, error = null, extra = {} } = {}) {
  if (execution && typeof execution === 'object') {
    // Emite toast de erro via WS (antes de lançar)
    try {
      const tenantId = execution?.options?.tenantId || extra?.tenantId || null;
      const executionId = execution?.executionId || null;
      if (tenantId && executionId) {
        const safeMessage = safeErrorMessage(error);
        emitPipelineStage(createPipelineWs({ tenantId }), executionId, {
          stage: extra?.stage || execution?.currentStage || 'pipeline',
          status: 'error',
          message: safeMessage || 'Falha no pipeline',
          meta: extra || null,
        });
      }
    } catch (_) {
      // best-effort
    }

    updateStatus(execution, 'failed', {
      // Padroniza reason como objeto com code (para UI/analytics)
      reason: (typeof reason === 'string') ? { code: reason } : reason,
      currentStage: execution.currentStage || null,
      stageStatus: 'error',
      ...(error ? { message: safeErrorMessage(error) } : {}),
      ...(extra && typeof extra === 'object' ? { extra } : {}),
    });
  }
  if (error) throw error;
  throw new Error('failGeneration chamado sem erro');
}

module.exports = { failGeneration };

