'use strict';

async function executeNodeWithIdempotency({
  node,
  context,
  compiledProcess,
  input,
  stateMachine,
  idempotencyService,
  contexts,
  ProcessExecutionContext,
  clone,
}) {
  const sideEffectTypes = new Set(['task.service', 'task.ai', 'task.message.send', 'call.subprocess']);
  const sequence = Number(context.lastProcessedSequence || 0);
  if (!sideEffectTypes.has(String(node.type))) {
    return stateMachine.executeNode(node, context, compiledProcess, input);
  }

  const run = await idempotencyService.runOnce(
    {
      executionId: context.executionId,
      nodeId: node.id,
      sequence,
    },
    async () => {
      const result = await stateMachine.executeNode(node, context, compiledProcess, input);
      return {
        output: clone(result.output || null),
        nextNodeId: result.nextNodeId,
        completed: result.completed,
        waiting: result.waiting,
        contextSnapshot: context.toSnapshot(),
      };
    },
  );

  context.metadata = {
    ...(context.metadata || {}),
    idempotencyRecords: {
      ...((context.metadata && context.metadata.idempotencyRecords) || {}),
      [run.key]: clone(run.value),
    },
  };

  if (run.reused) {
    const restored = ProcessExecutionContext.fromSnapshot(run.value.contextSnapshot);
    restored.metadata = {
      ...(restored.metadata || {}),
      idempotencyRecords: {
        ...((restored.metadata && restored.metadata.idempotencyRecords) || {}),
        [run.key]: clone(run.value),
      },
    };
    contexts.set(context.executionId, restored);
    return {
      output: run.value.output,
      nextNodeId: run.value.nextNodeId,
      completed: run.value.completed,
      waiting: run.value.waiting,
    };
  }

  return run.value;
}

module.exports = {
  executeNodeWithIdempotency,
};