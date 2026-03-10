'use strict';

const crypto = require('crypto');
const { writeOperationalEventBestEffort } = require('../crm/OperationalEventWriter');
const playbookExecutionStateStoreV2 = require('../operational-state/OperationalPlaybookExecutionStateStoreV2');
const { operationalOutcomeEngine } = require('../operational-outcomes');
const {
  PLAYBOOK_RUN_REFERENCE_TYPE,
} = require('../operational-compat');

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function nowIso() {
  return new Date().toISOString();
}

function newExecutionId() {
  return `opexec-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function withTimeout(promise, timeoutMs) {
  if (!timeoutMs) return promise;

  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('step_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeStepExecution(step) {
  const retryCount = toPositiveInt(step?.retryCount ?? step?.retries, 0);
  const explicitMaxAttempts = toPositiveInt(step?.maxAttempts, 0);
  const maxAttempts = Math.max(1, explicitMaxAttempts || (retryCount + 1));

  return {
    id: safeString(step?.id),
    type: safeString(step?.type),
    title: safeString(step?.title) || safeString(step?.type) || 'step',
    description: safeString(step?.description) || null,
    requiresConfirmation: step?.requiresConfirmation !== false,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    error: null,
    result: null,
    attempts: 0,
    maxAttempts,
    timeoutMs: toTimeoutMs(step?.timeoutMs ?? step?.timeout_ms ?? step?.timeout),
    nextOnSuccess: safeString(step?.nextOnSuccess || step?.next_on_success),
    nextOnFailure: safeString(step?.nextOnFailure || step?.next_on_failure),
    logs: [],
  };
}

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(obj.items) ? obj.items : [];
  return { items };
}

class PlaybookRunner {
  constructor({ stepExecutor, executionStore } = {}) {
    this.stepExecutor = stepExecutor;
    this.executionStore = executionStore || playbookExecutionStateStoreV2;
  }

  async run(playbook, context) {
    const tenantId = safeString(context?.tenantId);
    if (!tenantId) return { ok: false, error: 'tenant_required' };
    if (!playbook?.id) return { ok: false, error: 'playbook_required' };

    const execution = {
      id: newExecutionId(),
      playbookId: String(playbook.id),
      playbookName: safeString(playbook.name) || String(playbook.id),
      tenantId,
      contactId: safeString(context?.contactId),
      signalId: safeString(context?.signalId),
      recommendationId: safeString(context?.recommendationId),
      operatorId: safeString(context?.operatorId),
      status: 'in_progress',
      currentStepIndex: 0,
      steps: Array.isArray(playbook.steps) ? playbook.steps.map(normalizeStepExecution).filter(Boolean) : [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      abortedAt: null,
      lastError: null,
      stepLogs: [],
      context: {
        ...context,
        playbookId: String(playbook.id),
      },
    };

    await this.#saveExecution(tenantId, execution);
    this.#emitExecutionEvent('operational_playbook_started', execution, null);

    return {
      ok: true,
      execution,
    };
  }

  async executeStep(playbook, executionId, stepId, contextOverrides = {}) {
    const tenantId = safeString(contextOverrides?.tenantId);
    if (!tenantId) return { ok: false, error: 'tenant_required' };
    const id = safeString(executionId);
    if (!id) return { ok: false, error: 'execution_id_required' };

    const loaded = await this.getExecution({ tenantId, executionId: id });
    if (!loaded.ok) return loaded;

    const execution = loaded.execution;
    if (execution.playbookId !== String(playbook?.id || '')) {
      return { ok: false, error: 'playbook_execution_mismatch' };
    }
    if (execution.status !== 'in_progress') {
      return { ok: false, error: 'execution_not_in_progress', execution };
    }

    const stepKey = safeString(stepId);
    const stepIndex = execution.steps.findIndex((item) => String(item.id) === String(stepKey));
    if (stepIndex < 0) return { ok: false, error: 'step_not_found', execution };

    const step = execution.steps[stepIndex];
    if (step.status === 'completed') {
      return { ok: true, execution, step, skipped: true };
    }

    const stepContext = {
      ...execution.context,
      ...contextOverrides,
      tenantId,
      contactId: execution.contactId,
      signalId: execution.signalId,
      recommendationId: execution.recommendationId,
      operatorId: execution.operatorId,
      playbookId: execution.playbookId,
      playbookExecutionId: execution.id,
    };

    const maxAttempts = Math.max(1, toPositiveInt(step.maxAttempts, 1));
    const timeoutMs = toTimeoutMs(step.timeoutMs);
    let result = null;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      step.status = 'running';
      step.startedAt = step.startedAt || nowIso();
      step.error = null;
      step.attempts = attempt;
      execution.updatedAt = nowIso();
      this.#appendStepLog(execution, {
        level: 'info',
        event: 'step_attempt_started',
        stepId: step.id,
        attempt,
        maxAttempts,
      });
      await this.#saveExecution(tenantId, execution);

      try {
        result = await withTimeout(this.stepExecutor.executeStep(step, stepContext), timeoutMs);
        lastError = null;
        break;
      } catch (err) {
        lastError = err?.message || String(err);
        step.error = lastError;
        this.#appendStepLog(execution, {
          level: 'warn',
          event: 'step_attempt_failed',
          stepId: step.id,
          attempt,
          maxAttempts,
          error: lastError,
        });
        if (attempt < maxAttempts) {
          step.status = 'pending';
          execution.updatedAt = nowIso();
          await this.#saveExecution(tenantId, execution);
        }
      }
    }

    if (lastError) {
      step.status = 'failed';
      step.completedAt = nowIso();
      step.error = lastError;
      step.result = null;
      execution.lastError = step.error;
      execution.updatedAt = nowIso();

      const failureNextIndex = this.#resolveStepIndexById(execution.steps, step.nextOnFailure);
      if (failureNextIndex >= 0) {
        execution.currentStepIndex = failureNextIndex;
        execution.status = 'in_progress';
        this.#appendStepLog(execution, {
          level: 'warn',
          event: 'step_failed_branch',
          stepId: step.id,
          nextStepId: execution.steps[failureNextIndex]?.id || null,
          error: step.error,
        });
        this.#emitExecutionEvent('operational_playbook_step_failed', execution, step);
        await this.#saveExecution(tenantId, execution);
        return { ok: true, execution, step, branchedOnFailure: true };
      }

      execution.status = 'aborted';
      execution.abortedAt = nowIso();
      await this.#saveExecution(tenantId, execution);
      this.#emitExecutionEvent('operational_playbook_aborted', execution, step);
      await this.#recordPlaybookOutcome({
        execution,
        outcomeType: 'operational_playbook_aborted',
        status: 'failed',
        step,
      });

      return { ok: false, error: step.error, execution, step };
    }

    step.status = 'completed';
    step.completedAt = nowIso();
    step.result = result || null;
    step.error = null;

    const successNextIndex = this.#resolveStepIndexById(execution.steps, step.nextOnSuccess);
    execution.currentStepIndex = successNextIndex >= 0
      ? successNextIndex
      : this.#findNextPendingIndex(execution.steps);
    execution.updatedAt = nowIso();

    this.#appendStepLog(execution, {
      level: 'info',
      event: 'step_completed',
      stepId: step.id,
      attempts: step.attempts,
      nextStepId: execution.currentStepIndex >= 0 ? (execution.steps[execution.currentStepIndex]?.id || null) : null,
    });

    this.#emitExecutionEvent('operational_playbook_step_executed', execution, step);

    if (execution.currentStepIndex < 0) {
      execution.status = 'completed';
      execution.completedAt = nowIso();
      this.#emitExecutionEvent('operational_playbook_completed', execution, step);
      await this.#recordPlaybookOutcome({
        execution,
        outcomeType: 'operational_playbook_completed',
        status: 'success',
        step,
      });
    }

    await this.#saveExecution(tenantId, execution);
    return { ok: true, execution, step };
  }

  async nextStep(playbook, executionId, contextOverrides = {}) {
    const tenantId = safeString(contextOverrides?.tenantId);
    if (!tenantId) return { ok: false, error: 'tenant_required' };

    const loaded = await this.getExecution({ tenantId, executionId });
    if (!loaded.ok) return loaded;

    const execution = loaded.execution;
    const nextIndex = this.#findNextPendingIndex(execution.steps);
    if (nextIndex < 0) {
      return { ok: true, execution, done: true };
    }

    const step = execution.steps[nextIndex];
    return this.executeStep(playbook, execution.id, step.id, contextOverrides);
  }

  async getExecution({ tenantId, executionId }) {
    const tenantKey = safeString(tenantId);
    const executionKey = safeString(executionId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!executionKey) return { ok: false, error: 'execution_id_required' };

    return this.executionStore.getExecution({
      tenantId: tenantKey,
      executionId: executionKey,
    });
  }

  #findNextPendingIndex(steps) {
    return Array.isArray(steps)
      ? steps.findIndex((item) => String(item?.status || '').toLowerCase() === 'pending')
      : -1;
  }

  #resolveStepIndexById(steps, stepId) {
    const key = safeString(stepId);
    if (!key || !Array.isArray(steps)) return -1;
    return steps.findIndex((item) => String(item?.id || '') === key && String(item?.status || '').toLowerCase() === 'pending');
  }

  #appendStepLog(execution, logItem = {}) {
    if (!execution || typeof execution !== 'object') return;
    const current = Array.isArray(execution.stepLogs) ? execution.stepLogs : [];
    const next = {
      at: nowIso(),
      level: safeString(logItem.level) || 'info',
      event: safeString(logItem.event) || 'step_log',
      stepId: safeString(logItem.stepId),
      attempt: Number.isFinite(Number(logItem.attempt)) ? Number(logItem.attempt) : null,
      maxAttempts: Number.isFinite(Number(logItem.maxAttempts)) ? Number(logItem.maxAttempts) : null,
      attempts: Number.isFinite(Number(logItem.attempts)) ? Number(logItem.attempts) : null,
      nextStepId: safeString(logItem.nextStepId),
      error: safeString(logItem.error),
    };
    execution.stepLogs = [...current, next].slice(-500);

    const steps = Array.isArray(execution.steps) ? execution.steps : [];
    const index = steps.findIndex((item) => String(item?.id || '') === String(next.stepId || ''));
    if (index >= 0) {
      const stepLogs = Array.isArray(steps[index].logs) ? steps[index].logs : [];
      steps[index].logs = [...stepLogs, next].slice(-200);
    }
  }

  async #saveExecution(tenantId, execution) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey || !execution) return;

    return this.executionStore.upsertExecution({
      tenantId: tenantKey,
      execution,
    });
  }

  #emitExecutionEvent(type, execution, step) {
    writeOperationalEventBestEffort({
      tenantId: execution.tenantId,
      contactId: execution.contactId || null,
      type,
      sourceModule: 'operational_playbooks',
      referenceType: PLAYBOOK_RUN_REFERENCE_TYPE,
      referenceId: execution.id,
      payload: {
        executionId: execution.id,
        playbookRunId: execution.id,
        playbookExecutionId: execution.id,
        playbookId: execution.playbookId,
        playbookName: execution.playbookName,
        stepId: safeString(step?.id),
        stepType: safeString(step?.type),
        signalId: execution.signalId || null,
        recommendationId: execution.recommendationId || null,
        operatorId: execution.operatorId || null,
        status: execution.status,
        stepStatus: safeString(step?.status),
      },
      actorType: execution.operatorId ? 'user' : 'system',
      actorId: execution.operatorId || 'operational-playbooks',
      correlationId: execution.id,
    }, 'PlaybookRunner');
  }

  async #recordPlaybookOutcome({ execution, outcomeType, status, step = null } = {}) {
    try {
      await operationalOutcomeEngine.recordOutcome({
        tenantId: execution.tenantId,
        contactId: execution.contactId || null,
        signalId: execution.signalId || null,
        recommendationId: execution.recommendationId || null,
        playbookExecutionId: execution.id,
        sourceType: 'playbook',
        sourceId: execution.playbookId,
        actionType: 'playbook_execution',
        outcomeType,
        outcomeScore: status === 'success' ? 0.9 : 0.2,
        status,
        producedAt: new Date(),
        resultContext: {
          executionId: execution.id,
          playbookId: execution.playbookId,
          playbookName: execution.playbookName,
          stepId: safeString(step?.id),
          stepType: safeString(step?.type),
          lastError: execution.lastError || safeString(step?.error),
        },
      });
    } catch (_) {}
  }
}

module.exports = {
  PlaybookRunner,
};
