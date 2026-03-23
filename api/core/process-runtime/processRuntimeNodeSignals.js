'use strict';

async function emitNodeRuntimeSignals({
  node,
  result,
  context,
  compiledProcess,
  emitProcessEvent,
}) {
  if (node.type === 'gateway.exclusive') {
    await emitProcessEvent('GATEWAY_DECISION', {
      context,
      compiledProcess,
      node,
      payload: {
        chosenNext: result.output?.chosenNext || result.nextNodeId || null,
        currentNodeId: context.currentNodeId,
      },
    });
  }

  if (node.type === 'call.subprocess') {
    await emitProcessEvent('SUBPROCESS_ENTER', {
      context,
      compiledProcess,
      node,
      payload: { calledElement: result.output?.calledElement || null },
    });
  }

  if (node.type === 'task.user') {
    await emitProcessEvent('HUMAN_HANDOFF', {
      context,
      compiledProcess,
      node,
      payload: { queue: result.output?.queue || null },
    });
  }

  if (node.type === 'fallback') {
    await emitProcessEvent('NODE_FALLBACK', {
      context,
      compiledProcess,
      node,
      payload: { mode: result.output?.mode || null, target: result.output?.target || null },
    });
  }
}

async function emitNodePostExitSignals({
  node,
  context,
  compiledProcess,
  emitProcessEvent,
}) {
  if (node.type === 'call.subprocess') {
    await emitProcessEvent('SUBPROCESS_EXIT', {
      context,
      compiledProcess,
      node,
      payload: { currentNodeId: context.currentNodeId },
    });
  }
}

module.exports = {
  emitNodeRuntimeSignals,
  emitNodePostExitSignals,
};