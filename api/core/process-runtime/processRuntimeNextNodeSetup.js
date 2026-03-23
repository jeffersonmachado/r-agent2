'use strict';

async function setupNextNodeExecution({
  contextOrExecutionId,
  input,
  sanitizeRuntimeInput,
  loadContextForExecution,
  processes,
  buildResult,
  PROCESS_INSTANCE_STATUSES,
}) {
  const safeInput = sanitizeRuntimeInput(input);
  const executionId = typeof contextOrExecutionId === 'string'
    ? String(contextOrExecutionId)
    : String(contextOrExecutionId?.executionId || '');

  const loaded = typeof contextOrExecutionId === 'string'
    ? await loadContextForExecution(executionId)
    : {
      context: contextOrExecutionId,
      compiledProcess: processes.get(executionId) || null,
    };

  const context = loaded.context;
  const compiledProcess = loaded.compiledProcess || processes.get(executionId) || null;

  if (!context || !compiledProcess) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  if (context.status === PROCESS_INSTANCE_STATUSES.WAITING && context.waitingState) {
    return {
      input: safeInput,
      executionId,
      context,
      compiledProcess,
      earlyResult: await buildResult(executionId, compiledProcess, context, null),
    };
  }

  return {
    input: safeInput,
    executionId,
    context,
    compiledProcess,
    earlyResult: null,
  };
}

module.exports = {
  setupNextNodeExecution,
};