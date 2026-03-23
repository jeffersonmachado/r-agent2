'use strict';

async function handleMissingNodeFailure({
  context,
  compiledProcess,
  instanceStore,
  emitProcessEvent,
}) {
  context.status = 'failed';
  await instanceStore.markFailed(context.executionId, new Error('node_not_found'));
  await emitProcessEvent('PROCESS_FAILED', {
    context,
    compiledProcess,
    payload: { reason: 'node_not_found', currentNodeId: context.currentNodeId },
  });
}

module.exports = {
  handleMissingNodeFailure,
};