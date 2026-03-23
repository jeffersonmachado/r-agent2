'use strict';

const { deriveWaitingState } = require('./processRuntimeWaitingState');

async function handleWaitingTransition({
  node,
  context,
  result,
  stepInput,
  compiledProcess,
  instanceStore,
  emitProcessEvent,
  persistContextSnapshot,
  startDeferredSubprocess,
  clone,
}) {
  if (!result?.waiting) return false;

  const waitingState = deriveWaitingState(node, context, result, stepInput);
  context.setWaitingState(waitingState);
  await instanceStore.markWaiting(context.executionId, waitingState);
  await emitProcessEvent('NODE_WAITING', {
    context,
    compiledProcess,
    node,
    payload: {
      currentNodeId: context.currentNodeId,
      variablesSnapshot: clone(context.variables),
      historySnapshot: clone(context.history),
      waitingState,
    },
  });
  await persistContextSnapshot(context);

  if (node.type === 'call.subprocess' && result.output?.deferredSubprocessStart) {
    startDeferredSubprocess(result.output).catch(() => null);
  }

  return true;
}

module.exports = {
  handleWaitingTransition,
};