'use strict';

const {
  getStepSpec,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  getEntityScopeForStep,
  getExpectedNetworkEventsForStep,
  isMutationExpectedStep: registryIsMutationExpectedStep,
  matchExpectedNetworkEvent,
} = require('../../qa/contracts/operationalStepRegistry');

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

/**
 * Enrich observed mutations with provenance: where they came from and why they were attributed to this step
 */
function computeMutationProvenanceForReplay(step, entityScope = []) {
  const observedMutations = safeArray(step?.observedMutations);
  const networkEvents = safeArray(step?.networkEvents);
  const beforeSnapshotHash = step?.beforeSnapshotHash || null;
  const afterSnapshotHash = step?.afterSnapshotHash || null;
  const stepId = step?.id || step?.stepId || null;
  const semanticContract = stepId ? getStepSpec(stepId) : null;
  const actionType = semanticContract?.actionType || step?.actionType || step?.action || step?.type || 'unknown';

  // CAUSALIDADE: usar matchExpectedNetworkEvent do contrato, não primeiro response com status 2xx
  const contractMatchedEvent = stepId ? matchExpectedNetworkEvent(stepId, networkEvents) : null;
  return observedMutations.map((mutation) => {
    const hasMatchedNetworkEvent = Boolean(contractMatchedEvent);
    const originatingNetworkEvent = hasMatchedNetworkEvent ? contractMatchedEvent : null;
    const originatingNetworkEvents = hasMatchedNetworkEvent ? [contractMatchedEvent] : [];

    return {
      mutation,
      originatingStepId: stepId,
      originatingActionType: actionType,
      originatingNetworkEvent,
      originatingNetworkEvents,
      entityScope: Array.isArray(entityScope) ? entityScope : [],
      beforeStepSnapshotHash: beforeSnapshotHash,
      afterStepSnapshotHash: afterSnapshotHash,
      beforeSnapshotHash,
      afterSnapshotHash,
      correlatedBy: hasMatchedNetworkEvent ? 'network_linkage' : 'expected_network_event_not_found',
      valid: hasMatchedNetworkEvent,
      reason: hasMatchedNetworkEvent ? null : 'expected_network_event_not_found',
    };
  });
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

  // Query semantic contract from registry
  const stepId = step?.id || step?.stepId || `step-${index + 1}`;
  const registrySpec = getStepSpec(stepId);
  const semanticContract = registrySpec || null;
  const mutationExpected = registrySpec ? registryIsMutationExpectedStep(registrySpec) : false;
  const expectedMutations = registrySpec ? getExpectedMutationsForStep(registrySpec) : [];
  const expectedSideEffects = registrySpec ? getExpectedSideEffectsForStep(registrySpec) : [];
  const entityScope = registrySpec ? getEntityScopeForStep(stepId) : [];
  const expectedNetworkEvents = registrySpec ? getExpectedNetworkEventsForStep(stepId) : [];
  const evidenceClassification = step?.evidenceClassification === 'diagnostic_only'
    ? 'diagnostic_only'
    : 'operational';
  const observedNetworkEvents = networkEvents
    .filter((event) => event && event.type === 'response')
    .map((event) => ({
      method: event.method || null,
      url: event.url || null,
      status: event.status || null,
    }));
  const matchedNetworkEvent = stepId ? matchExpectedNetworkEvent(stepId, networkEvents) : null;
  const networkCorrelation = Array.isArray(step?.networkCorrelation)
    ? step.networkCorrelation
    : Array.isArray(step?.postStateProof?.networkCorrelation)
      ? step.postStateProof.networkCorrelation
      : matchedNetworkEvent
        ? [{
            method: matchedNetworkEvent.method || null,
            url: matchedNetworkEvent.url || null,
            status: matchedNetworkEvent.status || null,
            correlatedBy: 'expected_network_event',
          }]
        : [];

  // Compute mutation provenance
  const observedMutations = safeArray(step?.observedMutations);
  const mutationProvenance = safeArray(step?.mutationProvenance).length > 0
    ? safeArray(step.mutationProvenance)
    : computeMutationProvenanceForReplay(step, entityScope);
  const provenanceInvalid = mutationProvenance.find((record) => record?.valid !== true) || null;
  const provenance = {
    valid: mutationProvenance.length === 0 ? mutationExpected === false : !provenanceInvalid,
    reason: provenanceInvalid ? (provenanceInvalid.reason || 'expected_network_event_not_found') : null,
  };

  return {
    id: stepId,
    index: Number.isFinite(Number(step?.index)) ? Number(step.index) : index + 1,
    order: Number.isFinite(Number(step?.order)) ? Number(step.order) : (index + 1),
    type: step?.type || null,
    category: step?.category || null,
    actor: step?.actor || null,
    name: step?.name || step?.title || `Passo ${index + 1}`,
    description: step?.description || null,
    action,
    actionType: semanticContract?.actionType || step?.actionType || action,
    url: step?.url || step?.page || step?.route || step?.path || step?.input?.url || step?.evidence?.url || null,
    selector: step?.selector || null,
    selectorUsed: step?.selectorUsed || step?.selector || step?.dataTestId || null,
    input: step?.input !== undefined ? step.input : (step?.value !== undefined ? step.value : null),
    expected: step?.expected !== undefined ? step.expected : (step?.condition !== undefined ? step.condition : null),
    actual: step?.actual !== undefined ? step.actual : (step?.success === true ? 'ok' : (step?.error || null)),
    status: mapStatus(step?.status || (step?.success === true ? 'success' : (step?.success === false ? 'failed' : replayStatus)), replayStatus),
    startedAt,
    finishedAt,
    timestamp: startedAt,
    durationMs: toDurationMs(startedAt, finishedAt, step?.durationMs || step?.duration || 0),
    screenshotBefore,
    screenshotAfter,
    domSnapshot: step?.domSnapshot || step?.evidence?.domSnapshot || null,
    consoleLogs,
    consoleErrors: consoleLogs,
    networkEvents,
    evidenceId: step?.evidenceId || null,
    stepResult: step?.stepResult || null,
    mutationLinkage: step?.mutationLinkage || null,
    stepExecutionProof: step?.stepExecutionProof || null,
    postStateProof: step?.postStateProof || null,
    proofChain: step?.proofChain || null,
    beforeStepSnapshot: step?.beforeStepSnapshot || null,
    afterStepSnapshot: step?.afterStepSnapshot || null,
    incrementalDiff: step?.incrementalDiff || null,
    observedMutations,
    observedSideEffects: Array.isArray(step?.observedSideEffects) ? step.observedSideEffects : [],
    observedNetworkEvents,
    networkCorrelation,
    evidenceClassification,
    executionMode: step?.executionMode || 'operational_go',
    // SEMANTIC CONSISTENCY: Phase 2 fields
    semanticContract,
    mutationExpected,
    expectedMutations,
    expectedSideEffects,
    expectedNetworkEvents,
    entityScope,
    provenance,
    mutationProvenance,
    evidence: {
      screenshotBefore,
      screenshotAfter,
      url: step?.url || step?.page || step?.route || step?.path || step?.input?.url || null,
      payload: step?.evidence?.payload ?? step?.input ?? null,
      apiResponse: step?.evidence?.apiResponse || null,
      domSnapshot: step?.domSnapshot || step?.evidence?.domSnapshot || null,
      networkEvents,
      consoleErrors: consoleLogs,
      selectorUsed: step?.selectorUsed || step?.selector || step?.dataTestId || null,
      evidenceId: step?.evidenceId || null,
      mutationLinkage: step?.mutationLinkage || null,
      stepResult: step?.stepResult || null,
      stepExecutionProof: step?.stepExecutionProof || null,
      postStateProof: step?.postStateProof || null,
      proofChain: step?.proofChain || null,
      beforeStepSnapshot: step?.beforeStepSnapshot || null,
      afterStepSnapshot: step?.afterStepSnapshot || null,
      incrementalDiff: step?.incrementalDiff || null,
      observedMutations,
      observedSideEffects: Array.isArray(step?.observedSideEffects) ? step.observedSideEffects : [],
      observedNetworkEvents,
      networkCorrelation,
      evidenceClassification,
      executionMode: step?.executionMode || 'operational_go',
      // SEMANTIC CONSISTENCY: Phase 2 fields
      semanticContract,
      mutationExpected,
      expectedMutations,
      expectedSideEffects,
      expectedNetworkEvents,
      entityScope,
      provenance,
      mutationProvenance,
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
  const normalizedSteps = sourceSteps.map((step, index) => normalizeStep(step, index, replayStatus));
  const executionMode = String(execution?.executionMode || execution?.mode || 'operational_go').toLowerCase();
  const steps = executionMode === 'operational_go'
    ? normalizedSteps.filter((step) => step.evidenceClassification === 'operational')
    : normalizedSteps;

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
      executionMode,
      generatedAt: nowIso(),
    },
  };

  return replay;
}

module.exports = {
  convertExecutionToReplay,
  normalizeStep,
  normalizeErrors,
};
