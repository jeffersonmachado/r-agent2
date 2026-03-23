'use strict';

async function handleCompletedTransition({
  result,
  context,
  compiledProcess,
  node,
  lastOutput,
  instanceStore,
  emitProcessEvent,
  timerService,
  notifyParentIfNeeded,
  clone,
}) {
  if (!result?.completed) return false;

  context.status = 'completed';
  await instanceStore.markCompleted(context.executionId, clone(context.metadata));
  await emitProcessEvent('PROCESS_COMPLETED', {
    context,
    compiledProcess,
    node,
    payload: {
      currentNodeId: null,
      output: clone(lastOutput || null),
      variablesSnapshot: clone(context.variables),
    },
  });
  timerService.cancelByExecutionId(context.executionId);
  await notifyParentIfNeeded(context, compiledProcess, lastOutput);

  return true;
}

module.exports = {
  handleCompletedTransition,
};