'use strict';

function toNodeErrorPayload(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || null,
  };
}

async function handleNodeExecutionFailure({
  error,
  context,
  compiledProcess,
  node,
  instanceStore,
  emitProcessEvent,
  notifyParentIfNeeded,
  clone,
}) {
  context.status = 'failed';

  if (error?.code === 'NODE_TIMEOUT') {
    await emitProcessEvent('NODE_TIMEOUT', {
      context,
      compiledProcess,
      node,
      payload: {
        currentNodeId: context.currentNodeId,
        timeoutMs: error.timeoutMs || null,
        variablesSnapshot: clone(context.variables),
        historySnapshot: clone(context.history),
      },
    });
  }

  const nodeError = toNodeErrorPayload(error);

  await emitProcessEvent('NODE_ERROR', {
    context,
    compiledProcess,
    node,
    payload: {
      error: nodeError,
      currentNodeId: context.currentNodeId,
      variablesSnapshot: clone(context.variables),
      historySnapshot: clone(context.history),
    },
  });

  await instanceStore.markFailed(context.executionId, error);

  await emitProcessEvent('PROCESS_FAILED', {
    context,
    compiledProcess,
    node,
    payload: { error: nodeError },
  });

  await notifyParentIfNeeded(context, compiledProcess, { error: nodeError });
}

module.exports = {
  handleNodeExecutionFailure,
};