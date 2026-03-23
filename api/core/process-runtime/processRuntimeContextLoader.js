'use strict';

async function loadRuntimeExecutionContext({
  executionId,
  contexts,
  processes,
  instanceStore,
  executionRepository,
  replayService,
  resolveCompiledProcessForInstance,
}) {
  const key = String(executionId || '');
  let context = contexts.get(key) || null;
  const compiledProcess = processes.get(key) || null;

  if (context && compiledProcess) {
    return { context, compiledProcess };
  }

  const instance = await instanceStore.loadInstance(key);
  if (!instance) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const resolvedProcess = compiledProcess || await resolveCompiledProcessForInstance(instance);
  const events = await executionRepository.listEventsByExecution(key);

  context = resolvedProcess && events.length > 0
    ? replayService.rebuildContextFromEvents(resolvedProcess, events)
    : replayService.rebuildContextFromInstance(instance);

  context.processId = instance.processId;
  context.processVersion = instance.processVersion || context.processVersion || 1;
  context.executionId = instance.executionId;
  context.startTime = instance.startedAt || context.startTime;
  context.metadata = {
    ...(context.metadata || {}),
    ...(instance.metadata || {}),
  };
  context.recovery = {
    ...(context.recovery || {}),
    from: resolvedProcess && events.length > 0 ? 'event-log' : 'instance',
    executionId: instance.executionId,
    updatedAt: instance.updatedAt || null,
  };

  contexts.set(key, context);
  if (resolvedProcess) {
    processes.set(key, resolvedProcess);
  }

  return { context, compiledProcess: resolvedProcess || processes.get(key) || null, instance };
}

module.exports = {
  loadRuntimeExecutionContext,
};