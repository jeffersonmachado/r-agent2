'use strict';

const { EventEmitter } = require('events');

const executions = new Map();

// Barramento em processo para sincronização em tempo real das execuções do mesh.
// Consumidores (monitor QA Waves, adapters) assinam eventos em vez de fazer polling.
const executionEvents = new EventEmitter();
executionEvents.setMaxListeners(200);

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(String(status || '').toLowerCase());
}

/**
 * Aguarda uma execução atingir status terminal, orientado a evento (sem polling).
 * Resolve com o registro da execução; rejeita com code 'EXECUTION_WAIT_TIMEOUT'
 * ao estourar o orçamento de tempo (um único deadline, não um loop de polling).
 */
function waitForQueuedExecution(executionId, { timeoutMs = 60000, onUpdate = null } = {}) {
  return new Promise((resolve, reject) => {
    const existing = executions.get(executionId);
    if (existing && isTerminalStatus(existing.status)) {
      resolve(existing);
      return;
    }

    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      executionEvents.off('updated', handleUpdate);
      const err = new Error(`Timeout aguardando execução ${executionId}`);
      err.code = 'EXECUTION_WAIT_TIMEOUT';
      reject(err);
    }, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();

    function handleUpdate(record) {
      if (!record || record.executionId !== executionId || settled) return;
      if (typeof onUpdate === 'function') {
        try { onUpdate(record); } catch (_) { /* listener não quebra o wait */ }
      }
      if (isTerminalStatus(record.status)) {
        settled = true;
        clearTimeout(deadline);
        executionEvents.off('updated', handleUpdate);
        resolve(record);
      }
    }

    executionEvents.on('updated', handleUpdate);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function createExecutionRecord(kind, payload = {}) {
  const executionId = `meshq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    executionId,
    tenantId: payload?.tenantId || 'system',
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
  executionEvents.emit('updated', record);
  return record;
}

function getExecution(executionId) {
  return executions.get(executionId) || null;
}

function getAllExecutions(limit = 20, options = {}) {
  const tenantId = options && options.tenantId != null ? String(options.tenantId) : null;
  return Array.from(executions.values())
    .filter((record) => tenantId == null || String(record?.payload?.tenantId || '') === tenantId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function getActiveExecution() {
  for (const record of executions.values()) {
    if (record.status === 'running' || record.status === 'queued') {
      return record;
    }
  }
  return null;
}

function enqueueExecution(kind, payload, runner) {
  const active = getActiveExecution();
  if (active) {
    const err = new Error(
      `Já existe uma execução em andamento (${active.executionId}). Aguarde a conclusão antes de iniciar uma nova onda.`
    );
    err.code = 'EXECUTION_ALREADY_RUNNING';
    err.activeExecutionId = active.executionId;
    throw err;
  }

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

function clearExecutions(options = null) {
  // Backward-compatible process reset for test/bootstrap callers. HTTP paths
  // must always provide a tenant and can only discard terminal in-memory state;
  // persisted evidence and the append-only chain are never deleted here.
  if (!options || options.tenantId == null) {
    const cleared = executions.size;
    executions.clear();
    return { cleared, skippedActive: 0 };
  }

  const tenantId = String(options.tenantId);
  let cleared = 0;
  let skippedActive = 0;
  for (const [executionId, record] of executions.entries()) {
    if (String(record?.payload?.tenantId || '') !== tenantId) continue;
    if (!isTerminalStatus(record.status)) {
      skippedActive += 1;
      continue;
    }
    executions.delete(executionId);
    cleared += 1;
  }
  return { cleared, skippedActive };
}

module.exports = {
  appendLog,
  updateExecution,
  getExecution,
  getAllExecutions,
  enqueueExecution,
  clearExecutions,
  executionEvents,
  waitForQueuedExecution,
  isTerminalStatus,
};
