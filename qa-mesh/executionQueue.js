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

/** Chave de tenant de um registro. `null` agrupa execuções sem tenant declarado. */
function tenantKeyOf(record) {
  const bruto = record && record.payload ? record.payload.tenantId : null;
  if (bruto === null || bruto === undefined || bruto === '') return null;
  return String(bruto);
}

/**
 * Execução ativa (running/queued).
 *
 * DEFEITO CORRIGIDO (2026-10-30, LRO Fase 0 — docs/architecture/lro-qa-waves.md §3.1): sem filtro de
 * tenant esta função fazia a onda em execução do tenant A bloquear o `enqueue` do tenant B com
 * `EXECUTION_ALREADY_RUNNING` — indisponibilidade CRUZADA entre clientes, sem relação entre os
 * payloads. A exclusão mútua passou a ser POR TENANT; sem argumento o comportamento antigo (global)
 * é preservado para leitores de diagnóstico.
 *
 * @param {string|null|undefined} tenantId `undefined` = varredura global (compatibilidade)
 */
function getActiveExecution(tenantId) {
  const escopo = tenantId === undefined ? undefined : (tenantId === null || tenantId === '' ? null : String(tenantId));
  for (const record of executions.values()) {
    if (record.status !== 'running' && record.status !== 'queued') continue;
    if (escopo === undefined) return record;
    if (tenantKeyOf(record) === escopo) return record;
  }
  return null;
}

/**
 * Desfecho terminal de uma execução — FAIL-CLOSED (P1-G).
 *
 * Antes: `status: summary.goNoGo === 'NO_GO' ? 'failed' : 'completed'` + `progress: 100`. Ou seja,
 * AUSÊNCIA de resumo/goNoGo virava sucesso com 100%: runner que devolve `undefined`, `SKIPPED`,
 * `NOT_EXECUTED` ou `UNKNOWN` era contabilizado como execução concluída (e contaminava cobertura e
 * certificação agregada). Só `GO` explícito conclui; `NO_GO` falha; todo o resto é falha com motivo
 * e progresso DESCONHECIDO (nunca 100%).
 *
 * @param {object|undefined} resultado
 * @returns {{status:'completed'|'failed', progress:number|null, goNoGo:string|null, motivo:string|null, summary:object|null, results:Array, historyPath:string|null, evidenceDir:string|null}}
 */
function desfechoTerminal(resultado) {
  const summary = (resultado && typeof resultado === 'object' && resultado.summary) || null;
  const goNoGo = summary && typeof summary === 'object' ? (summary.goNoGo || null) : null;
  const base = {
    goNoGo,
    summary,
    results: (resultado && resultado.results) || [],
    historyPath: (resultado && resultado.historyPath) || null,
    evidenceDir: (resultado && resultado.evidenceDir) || null,
  };
  if (goNoGo === 'GO') return { ...base, status: 'completed', progress: 100, motivo: null };
  if (goNoGo === 'NO_GO') return { ...base, status: 'failed', progress: 100, motivo: 'NO_GO' };
  return {
    ...base,
    status: 'failed',
    progress: null, // desconhecido: não se presume 100%
    motivo: goNoGo ? `GONOGO_INVALIDO:${goNoGo}` : 'SEM_SUMMARY',
  };
}

function enqueueExecution(kind, payload, runner) {
  const tenantIdBruto = payload && payload.tenantId != null ? payload.tenantId : null;
  const active = getActiveExecution(tenantIdBruto === '' ? null : tenantIdBruto);
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
      const desfecho = desfechoTerminal(result);
      updateExecution(record.executionId, {
        status: desfecho.status,
        finishedAt: nowIso(),
        progress: desfecho.progress,
        summary: desfecho.summary,
        results: desfecho.results,
        historyPath: desfecho.historyPath,
        evidenceDir: desfecho.evidenceDir,
        ...(desfecho.motivo ? { outcomeReason: desfecho.motivo } : {}),
      });
      appendLog(record.executionId, 'EXECUTION_FINISHED',
        desfecho.status === 'completed' ? 'success' : 'error',
        { goNoGo: desfecho.goNoGo, motivo: desfecho.motivo });
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
  desfechoTerminal,
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
