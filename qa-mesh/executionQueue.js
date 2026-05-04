'use strict';

const executions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createExecutionRecord(kind, payload = {}) {
  const executionId = `meshq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    executionId,
    kind,
    status: 'queued',
    progress: 0,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    payload,
    summary: null,
    results: [],
    error: null,
    logs: [],
  };
  executions.set(executionId, record);
  return record;
}

function appendLog(executionId, message, level = 'info', extra = {}) {
  const record = executions.get(executionId);
  if (!record) return;
  record.logs.push({
    timestamp: nowIso(),
    level,
    message,
    ...extra,
  });
  if (record.logs.length > 500) {
    record.logs.shift();
  }
}

function updateExecution(executionId, patch = {}) {
  const record = executions.get(executionId);
  if (!record) return null;
  Object.assign(record, patch);
  return record;
}

function getExecution(executionId) {
  return executions.get(executionId) || null;
}

function getAllExecutions(limit = 20) {
  return Array.from(executions.values())
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function enqueueExecution(kind, payload, runner) {
  const record = createExecutionRecord(kind, payload);
  queueMicrotask(async () => {
    try {
      updateExecution(record.executionId, { status: 'running', startedAt: nowIso() });
      appendLog(record.executionId, 'EXECUTION_STARTED', 'info', { kind });
      const result = await runner(record.executionId);
      updateExecution(record.executionId, {
        status: result?.summary?.goNoGo === 'NO_GO' ? 'failed' : 'completed',
        finishedAt: nowIso(),
        progress: 100,
        summary: result?.summary || null,
        results: result?.results || [],
        historyPath: result?.historyPath || null,
        evidenceDir: result?.evidenceDir || null,
      });
      appendLog(record.executionId, 'EXECUTION_FINISHED', 'success', {
        goNoGo: result?.summary?.goNoGo || null,
      });
    } catch (error) {
      updateExecution(record.executionId, {
        status: 'failed',
        finishedAt: nowIso(),
        error: error.message || String(error),
      });
      appendLog(record.executionId, error.message || String(error), 'error');
    }
  });
  return {
    executionId: record.executionId,
    status: record.status,
  };
}

function clearExecutions() {
  executions.clear();
}

module.exports = {
  appendLog,
  updateExecution,
  getExecution,
  getAllExecutions,
  enqueueExecution,
  clearExecutions,
};
