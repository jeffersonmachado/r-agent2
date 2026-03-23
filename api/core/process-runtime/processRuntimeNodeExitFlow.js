'use strict';

async function handleNodeExitTransition({
  node,
  result,
  context,
  compiledProcess,
  emitProcessEvent,
  persistContextSnapshot,
  clone,
}) {
  await emitProcessEvent('NODE_EXIT', {
    context,
    compiledProcess,
    node,
    payload: {
      currentNodeId: context.currentNodeId,
      nextNodeId: result.nextNodeId || context.currentNodeId,
      output: clone(result.output || null),
      variablesSnapshot: clone(context.variables),
      historySnapshot: clone(context.history),
    },
  });

  await persistContextSnapshot(context);
}

module.exports = {
  handleNodeExitTransition,
};