'use strict';

const { PROCESS_INSTANCE_STATUSES } = require('./processInstanceTypes');

async function buildExecutionResult({
  executionId,
  context,
  output,
  instanceStore,
  executionRepository,
  observability,
}) {
  const instance = await instanceStore.loadInstance(executionId);
  const events = await executionRepository.listEventsByExecution(executionId);

  return {
    ok: context.status !== PROCESS_INSTANCE_STATUSES.FAILED,
    runtime: 'durable-canonical',
    executionId: context.executionId,
    status: context.status,
    currentNodeId: context.currentNodeId,
    context: context.toSnapshot(),
    instance,
    output: output || null,
    events,
    observability: observability.getRecords({ executionId: context.executionId }),
  };
}

async function recoverRuntimeTimers(timerService) {
  const recoveredTimers = await timerService.recoverPendingTimers();
  const resumedTimers = await timerService.resumeExpiredTimers();

  return {
    recoveredTimers,
    resumedTimers,
  };
}

module.exports = {
  buildExecutionResult,
  recoverRuntimeTimers,
};