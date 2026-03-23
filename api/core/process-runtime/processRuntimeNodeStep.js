'use strict';

const { clone } = require('./processRuntimeHelpers');
const { emitNodeEnter } = require('./processRuntimeNodeEntryFlow');
const { incrementNodeAttempt } = require('./processRuntimeNodeAttempts');
const { handleNodeExecutionFailure } = require('./processRuntimeNodeFailure');
const { emitNodeRuntimeSignals, emitNodePostExitSignals } = require('./processRuntimeNodeSignals');
const { handleWaitingTransition } = require('./processRuntimeWaitingFlow');
const { handleNodeExitTransition } = require('./processRuntimeNodeExitFlow');
const { handleCompletedTransition } = require('./processRuntimeCompletionFlow');

async function executeRuntimeNodeStep({
  node,
  context,
  compiledProcess,
  input,
  lastOutput,
  runtime,
}) {
  incrementNodeAttempt(context, node.id);

  await emitNodeEnter({
    context,
    compiledProcess,
    node,
    emitProcessEvent: runtime.emitProcessEvent,
    clone,
  });

  let result;
  const stepInput = input;
  try {
    result = await runtime.executeNodeWithPolicies(node, context, compiledProcess, stepInput);
  } catch (error) {
    await handleNodeExecutionFailure({
      error,
      context,
      compiledProcess,
      node,
      instanceStore: runtime.instanceStore,
      emitProcessEvent: runtime.emitProcessEvent,
      notifyParentIfNeeded: runtime.notifyParentIfNeeded,
      clone,
    });
    return {
      shouldBreak: true,
      nextInput: stepInput,
      lastOutput,
    };
  }

  const nextLastOutput = result.output || null;
  const nextInput = null;

  await emitNodeRuntimeSignals({
    node,
    result,
    context,
    compiledProcess,
    emitProcessEvent: runtime.emitProcessEvent,
  });

  if (await handleWaitingTransition({
    node,
    context,
    result,
    stepInput,
    compiledProcess,
    instanceStore: runtime.instanceStore,
    emitProcessEvent: runtime.emitProcessEvent,
    persistContextSnapshot: runtime.persistContextSnapshot,
    startDeferredSubprocess: runtime.startDeferredSubprocess,
    clone,
  })) {
    return {
      shouldBreak: true,
      nextInput,
      lastOutput: nextLastOutput,
    };
  }

  await handleNodeExitTransition({
    node,
    result,
    context,
    compiledProcess,
    emitProcessEvent: runtime.emitProcessEvent,
    persistContextSnapshot: runtime.persistContextSnapshot,
    clone,
  });

  await emitNodePostExitSignals({
    node,
    context,
    compiledProcess,
    emitProcessEvent: runtime.emitProcessEvent,
  });

  if (await handleCompletedTransition({
    result,
    context,
    compiledProcess,
    node,
    lastOutput: nextLastOutput,
    instanceStore: runtime.instanceStore,
    emitProcessEvent: runtime.emitProcessEvent,
    timerService: runtime.timerService,
    notifyParentIfNeeded: runtime.notifyParentIfNeeded,
    clone,
  })) {
    return {
      shouldBreak: true,
      nextInput,
      lastOutput: nextLastOutput,
    };
  }

  return {
    shouldBreak: false,
    nextInput,
    lastOutput: nextLastOutput,
  };
}

module.exports = {
  executeRuntimeNodeStep,
};