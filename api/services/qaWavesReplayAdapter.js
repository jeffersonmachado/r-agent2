'use strict';

function nowIso() {
  return new Date().toISOString();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapStatus(value, fallback = 'failed') {
  const raw = String(value || '').toLowerCase();
  if (raw === 'success' || raw === 'passed' || raw === 'completed') return 'success';
  if (raw === 'timeout') return 'timeout';
  if (raw === 'skipped') return 'skipped';
  if (raw === 'failed' || raw === 'failure' || raw === 'error') return 'failed';
  return fallback;
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function toDurationMs(startedAt, finishedAt, fallback = 0) {
  const start = new Date(startedAt || 0).getTime();
  const end = new Date(finishedAt || 0).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return Math.max(0, end - start);
  }
  const n = Number(fallback);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeStep(step, index = 0, replayStatus = 'failed') {
  const action = step?.action || step?.type || 'unknown';
  const startedAt = toIso(step?.startedAt || step?.timestamp || step?.at, null);
  const finishedAt = toIso(step?.finishedAt || step?.timestamp || step?.at, startedAt);
  const isMutating = ['click', 'fill', 'type', 'select'].includes(String(action).toLowerCase());
  const screenshotAfter = step?.screenshotAfter || step?.screenshot || step?.screenshotDataUrl || null;
  const screenshotBefore = step?.screenshotBefore || (isMutating ? screenshotAfter : null);
  const consoleLogs = safeArray(step?.consoleLogs || step?.consoleErrors);
  const networkEvents = safeArray(step?.networkEvents);

  return {
    id: step?.id || `step-${index + 1}`,
    index: Number.isFinite(Number(step?.index)) ? Number(step.index) : index + 1,
    order: Number.isFinite(Number(step?.order)) ? Number(step.order) : (index + 1),
    type: step?.type || null,
    category: step?.category || null,
    actor: step?.actor || null,
    name: step?.name || step?.title || `Passo ${index + 1}`,
    description: step?.description || null,
    action,
    selector: step?.selector || null,
    input: step?.input !== undefined ? step.input : (step?.value !== undefined ? step.value : null),
    expected: step?.expected !== undefined ? step.expected : (step?.condition !== undefined ? step.condition : null),
    actual: step?.actual !== undefined ? step.actual : (step?.success === true ? 'ok' : (step?.error || null)),
    status: mapStatus(step?.status || (step?.success === true ? 'success' : (step?.success === false ? 'failed' : replayStatus)), replayStatus),
    startedAt,
    finishedAt,
    durationMs: toDurationMs(startedAt, finishedAt, step?.durationMs || step?.duration || 0),
    screenshotBefore,
    screenshotAfter,
    domSnapshot: step?.domSnapshot || step?.evidence?.domSnapshot || null,
    consoleLogs,
    consoleErrors: consoleLogs,
    networkEvents,
    evidence: {
      screenshotBefore,
      screenshotAfter,
      payload: step?.evidence?.payload ?? step?.input ?? null,
      apiResponse: step?.evidence?.apiResponse || null,
      domSnapshot: step?.domSnapshot || step?.evidence?.domSnapshot || null,
      networkEvents,
      consoleErrors: consoleLogs,
    },
    error: step?.error ? {
      message: typeof step.error === 'string' ? step.error : (step.error.message || String(step.error)),
      details: typeof step.error === 'object' ? step.error : null,
    } : null,
  };
}

function normalizeErrors(execution, steps) {
  const executionErrors = safeArray(execution?.errors);
  const stepErrors = steps
    .filter((step) => step && step.error)
    .map((step) => ({
      stepId: step.id,
      stepIndex: step.index,
      action: step.action,
      ...step.error,
    }));
  return [...executionErrors, ...stepErrors];
}

function convertExecutionToReplay(execution = {}, browserSession = {}) {
  const startedAt = toIso(execution.startedAt || execution.startTime, nowIso());
  const finishedAt = toIso(execution.finishedAt || execution.endTime, startedAt);
  const replayStatus = mapStatus(execution.status || execution.result, 'failed');

  const sourceSteps = safeArray(browserSession.steps).length > 0
    ? browserSession.steps
    : safeArray(execution.steps);
  const steps = sourceSteps.map((step, index) => normalizeStep(step, index, replayStatus));

  const replay = {
    replayId: execution.replayId || execution.id || `qa-wave-replay-${Date.now()}`,
    source: 'qa-waves',
    executionId: execution.executionId || null,
    waveId: execution.waveId || null,
    journeyId: execution.journeyId || null,
    scenarioId: execution.scenarioId || null,
    seedId: execution.seedId || null,
    startedAt,
    finishedAt,
    durationMs: toDurationMs(startedAt, finishedAt, execution.durationMs),
    status: replayStatus,
    browser: {
      name: browserSession?.browser?.name || execution?.browser?.name || 'chromium',
      version: browserSession?.browser?.version || execution?.browser?.version || null,
      viewport: browserSession?.browser?.viewport || execution?.browser?.viewport || { width: 1280, height: 720 },
    },
    steps,
    errors: normalizeErrors(execution, steps),
    tracePath: browserSession.tracePath || execution.tracePath || null,
    metadata: {
      traceWarning: browserSession.traceWarning || execution.traceWarning || null,
      platformAdapter: execution.platformAdapter || null,
      rpaReplayPath: browserSession.rpaReplayPath || null,
      generatedAt: nowIso(),
    },
  };

  return replay;
}

module.exports = {
  convertExecutionToReplay,
};
