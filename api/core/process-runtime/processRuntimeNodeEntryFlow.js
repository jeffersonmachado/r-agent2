'use strict';

async function emitNodeEnter({
  context,
  compiledProcess,
  node,
  emitProcessEvent,
  clone,
}) {
  await emitProcessEvent('NODE_ENTER', {
    context,
    compiledProcess,
    node,
    payload: {
      currentNodeId: context.currentNodeId,
      variablesSnapshot: clone(context.variables),
      historySnapshot: clone(context.history),
    },
  });
}

module.exports = {
  emitNodeEnter,
};