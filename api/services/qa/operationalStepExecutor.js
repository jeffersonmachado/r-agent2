'use strict';

/**
 * operationalStepExecutor.js
 *
 * Executor de steps operacionais browser-first.
 *
 * Pipeline de prova temporalmente correto:
 *   1. collectStepBeforeSnapshot()     — snapshot entity-scoped antes do step
 *   2. executeStep()                   — browser action
 *   2. validateStepExecutionProof()    — browser + network (step-time)
 *   4. collectStepAfterSnapshot()      — snapshot entity-scoped pós-step
 *   5. computeIncrementalStepDiff()    — diff incremental real
 *   6. deriveObservedMutations(diff)   — ids canônicos exatos
 *   7. deriveObservedSideEffects(diff) — ids canônicos exatos
 *   8. buildMutationLinkage()          — somente após incrementalDiff
 *   9. validatePostStateProof()        — prova de estado pós-step
 */

const { assertOperationalCondition, BlockingOperationalError } = require('./operationalAssertions');
const {
  getOperationalStepContract,
  isMutationExpectedStep,
  matchExpectedNetworkEvent,
  resolveJourneyId,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
} = require('../../../qa/contracts/operationalStepRegistry');
const {
  validateEvidenceByContract,
  resolveActionType,
  resolveEvidenceContract,
} = require('../../../qa/evidence/stepEvidenceContracts');
const { validateStepExecutionProof } = require('../../../qa/evidence/stepExecutionProofValidator');
const { computeRealSnapshotDiff } = require('../../../qa/evidence/evidenceProofValidator');
const postStateProofModule = require('../../../qa/evidence/postStateProofValidator');
const {
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
  computeIncrementalStepDiff,
  computeMutationProvenance,
} = postStateProofModule;

const BLOCKING_JOURNEYS = ['support_ticket_flow', 'fitness_customer_checkin'];

/**
 * Verifica se uma jornada é blocking.
 */
function isBlockingJourney(journeyId = '') {
  const resolved = resolveJourneyId(journeyId) || String(journeyId || '').toLowerCase();
  return BLOCKING_JOURNEYS.includes(resolved);
}

/**
 * Valida que um step executado possui todas as evidências obrigatórias.
 * @param {object} step - resultado do step executado
 * @param {string} journeyId
 * @returns {{ valid: boolean, missingEvidence: string[], blockers: object[] }}
 */
function validateStepEvidence(step = {}, journeyId = '', options = {}) {
  const blocking = isBlockingJourney(journeyId);
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  const contractValidation = validateEvidenceByContract({
    actionType: step?.actionType || step?.action || step?.type,
    evidence: step,
    journeyContext: {
      journeyId,
      stepId: step?.id || step?.stepId || 'unknown',
      isBlockingJourney: blocking,
      executionMode,
    },
  });

  return {
    valid: contractValidation.valid,
    missingEvidence: contractValidation.missingEvidence,
    blockers: contractValidation.blockers,
    requiredEvidence: contractValidation.requiredEvidence,
    observedEvidence: contractValidation.observedEvidence,
    evidenceContract: contractValidation.evidenceContract,
    actionType: contractValidation.actionType,
    isBlockingJourney: blocking,
    goNoGo: contractValidation.goNoGo,
  };
}

function makeEvidenceId(step = {}, options = {}) {
  const replayId = options.replayId || step?.replayId || 'replay';
  const executionId = options.executionId || step?.executionId || 'execution';
  const stepId = step?.id || step?.stepId || `step-${Date.now()}`;
  return `${replayId}:${executionId}:${stepId}`;
}

function buildMutationLinkage(step = {}, options = {}) {
  if (step?.mutationLinkage?.source === 'stateMutation' || options?.mutationLinkage?.source === 'stateMutation') {
    throw new BlockingOperationalError('state_mutation_not_allowed_as_step_proof', {
      stepId: step?.id || step?.stepId || null,
      source: 'stateMutation',
    });
  }

  const stepId = step?.id || step?.stepId || null;
  const isStepMutational = isMutationExpectedStep(stepId);
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  const incremental = options?.incrementalDiff || step?.incrementalDiff || null;
  const mutationCount = Number(incremental?.mutationCount || 0);

  // Causalidade válida exige snapshot incremental por step.
  if (mutationCount > 0) {
    if (isStepMutational) {
      return {
        replayId: options.replayId || step?.replayId || null,
        executionId: options.executionId || step?.executionId || null,
        stepId,
        mutationCount,
        expectedMutations: getExpectedMutationsForStep(stepId),
        observedMutations: Array.isArray(incremental?.observedMutations) ? incremental.observedMutations : [],
        expectedSideEffects: getExpectedSideEffectsForStep(stepId),
        observedSideEffects: Array.isArray(incremental?.observedSideEffects) ? incremental.observedSideEffects : [],
        correlatedBy: 'step_incremental',
        evidenceClassification: 'operational',
      };
    }

    if (executionMode !== 'diagnostic') return null;

    return {
      replayId: options.replayId || step?.replayId || null,
      executionId: options.executionId || step?.executionId || null,
      stepId,
      mutationCount,
      observedSideEffects: Array.isArray(incremental?.observedSideEffects)
        ? incremental.observedSideEffects
        : [],
      correlatedBy: 'journey_transition',
      evidenceClassification: 'diagnostic_only',
    };
  }
  return null;
}

function buildSideEffectLinkage(step = {}, options = {}, mutationLinkage = null) {
  const explicit = step?.sideEffectLinkage || options.sideEffectLinkage || null;
  if (explicit) return explicit;

  const stepId = step?.id || step?.stepId || null;
  const incremental = options?.incrementalDiff || step?.incrementalDiff || null;
  const expectedFromMutation = Array.isArray(mutationLinkage?.expectedSideEffects)
    ? mutationLinkage.expectedSideEffects
    : getExpectedSideEffectsForStep(stepId);
  const observedFromIncremental = Array.isArray(incremental?.observedSideEffects)
    ? incremental.observedSideEffects
    : [];

  if (expectedFromMutation.length === 0 && observedFromIncremental.length === 0) {
    return null;
  }

  return {
    expectedSideEffects: expectedFromMutation,
    observedSideEffects: observedFromIncremental,
    correlatedBy: 'step_incremental',
    evidenceClassification: mutationLinkage?.evidenceClassification || (String(options.executionMode || 'operational_go').toLowerCase() === 'diagnostic' ? 'diagnostic_only' : 'operational'),
  };
}

function buildSnapshotDiff(step = {}, options = {}) {
  const explicit = step?.snapshotDiff || options?.snapshotDiff || null;
  if (explicit) return explicit;

  const incremental = options?.incrementalDiff || step?.incrementalDiff || null;
  if (incremental?.diff) {
    return {
      changed: Boolean(incremental?.changed),
      details: Array.isArray(incremental?.diff?.details) ? incremental.diff.details : [],
      observedMutations: Array.isArray(incremental?.observedMutations) ? incremental.observedMutations : [],
      observedSideEffects: Array.isArray(incremental?.observedSideEffects) ? incremental.observedSideEffects : [],
      mutationCount: Number(incremental?.mutationCount || 0),
      valid: Boolean(incremental?.changed),
    };
  }

  if (options?.beforeStepSnapshot != null && options?.afterStepSnapshot != null) {
    const diff = computeRealSnapshotDiff(options.beforeStepSnapshot, options.afterStepSnapshot);
    const observedMutations = deriveObservedMutations(diff, step);
    const observedSideEffects = deriveObservedSideEffects(diff, step);
    return {
      changed: Boolean(diff?.changed),
      details: Array.isArray(diff?.details) ? diff.details : [],
      observedMutations,
      observedSideEffects,
      mutationCount: observedMutations.length,
      valid: Boolean(diff?.changed),
    };
  }

  return null;
}

function startNetworkCapture(playwrightPage) {
  if (!playwrightPage || typeof playwrightPage.on !== 'function') {
    return {
      events: [],
      stop: () => [],
    };
  }

  const events = [];
  const inflight = new Map();

  const onRequest = (request) => {
    const startedAt = Date.now();
    inflight.set(request, startedAt);
    events.push({
      type: 'request',
      url: request?.url?.() || null,
      method: request?.method?.() || null,
      status: null,
      duration: 0,
      failureReason: null,
      timestamp: new Date(startedAt).toISOString(),
    });
  };

  const onResponse = (response) => {
    const request = response?.request?.();
    const startedAt = inflight.get(request) || Date.now();
    const finishedAt = Date.now();
    inflight.delete(request);
    events.push({
      type: 'response',
      url: response?.url?.() || request?.url?.() || null,
      method: request?.method?.() || null,
      status: response?.status?.() || null,
      duration: Math.max(0, finishedAt - startedAt),
      failureReason: null,
      timestamp: new Date(finishedAt).toISOString(),
    });
  };

  const onRequestFailed = (request) => {
    const startedAt = inflight.get(request) || Date.now();
    const finishedAt = Date.now();
    inflight.delete(request);
    events.push({
      type: 'requestfailed',
      url: request?.url?.() || null,
      method: request?.method?.() || null,
      status: null,
      duration: Math.max(0, finishedAt - startedAt),
      failureReason: request?.failure?.()?.errorText || 'request_failed',
      timestamp: new Date(finishedAt).toISOString(),
    });
  };

  playwrightPage.on('request', onRequest);
  playwrightPage.on('response', onResponse);
  playwrightPage.on('requestfailed', onRequestFailed);

  return {
    events,
    stop: () => {
      if (typeof playwrightPage.off === 'function') {
        playwrightPage.off('request', onRequest);
        playwrightPage.off('response', onResponse);
        playwrightPage.off('requestfailed', onRequestFailed);
      }
      return events.slice();
    },
  };
}

function isStepSnapshotRequired(stepSpec = {}) {
  const stepId = stepSpec?.id || stepSpec?.stepId || null;
  const contract = getOperationalStepContract(stepId);
  if (contract) {
    return contract.snapshotRequired === true;
  }
  return isMutationExpectedStep(stepSpec);
}

async function collectStepBeforeSnapshot(stepSpec = {}, options = {}) {
  if (stepSpec?.beforeStepSnapshot != null) return stepSpec.beforeStepSnapshot;
  if (!isStepSnapshotRequired(stepSpec)) return null;
  if (typeof options.collectStepSnapshot !== 'function') return null;
  try {
    return await options.collectStepSnapshot({
      phase: 'before',
      stepSpec,
      stepId: stepSpec?.id || stepSpec?.stepId || null,
      actionType: stepSpec?.actionType || stepSpec?.action || stepSpec?.type || null,
    });
  } catch (err) {
    const stepId = stepSpec?.id || stepSpec?.stepId || null;
    const contract = getOperationalStepContract(stepId);
    const isBlocking = BLOCKING_JOURNEYS.includes(contract?.journeyId);
    if (contract?.snapshotRequired && isBlocking) {
      throw new BlockingOperationalError('snapshot_before_collection_failed', {
        stepId,
        error: err?.message || String(err),
      });
    }
    return null;
  }
}

async function collectStepAfterSnapshot(stepSpec = {}, stepResult = {}, options = {}) {
  if (stepResult?.afterStepSnapshot != null) return stepResult.afterStepSnapshot;
  if (stepSpec?.afterStepSnapshot != null) return stepSpec.afterStepSnapshot;
  if (!isStepSnapshotRequired(stepSpec)) return null;
  if (typeof options.collectStepSnapshot !== 'function') return null;
  try {
    return await options.collectStepSnapshot({
      phase: 'after',
      stepSpec,
      stepResult,
      stepId: stepResult?.id || stepSpec?.id || stepSpec?.stepId || null,
      actionType: stepResult?.actionType || stepSpec?.actionType || stepSpec?.action || stepSpec?.type || null,
    });
  } catch (err) {
    const stepId = stepResult?.id || stepSpec?.id || stepSpec?.stepId || null;
    const contract = getOperationalStepContract(stepId);
    const isBlocking = BLOCKING_JOURNEYS.includes(contract?.journeyId);
    if (contract?.snapshotRequired && isBlocking) {
      throw new BlockingOperationalError('snapshot_after_collection_failed', {
        stepId,
        error: err?.message || String(err),
      });
    }
    return null;
  }
}

/**
 * Valida array completo de steps de um replay.
 * Se algum step blocking vier sem evidência => goNoGo = NO_GO.
 */
function validateReplayStepsEvidence(steps = [], journeyId = '', options = {}) {
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  if (!Array.isArray(steps) || steps.length === 0) {
    const blocking = isBlockingJourney(journeyId);
    return {
      valid: false,
      stepsChecked: 0,
      totalBlockers: 0,
      blockers: [{ reason: 'replay_has_no_steps', journeyId, blocking }],
      goNoGo: blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
    };
  }

  const allBlockers = [];

  for (const step of steps) {
    const result = validateStepEvidence(step, journeyId, { executionMode });
    if (!result.valid) allBlockers.push(...result.blockers);
  }

  const hasBlockingBlockers = allBlockers.some((b) => b.blocking);

  return {
    valid: allBlockers.length === 0,
    stepsChecked: steps.length,
    totalBlockers: allBlockers.length,
    blockers: allBlockers,
    goNoGo: hasBlockingBlockers ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
  };
}

/**
 * Enriquece um step com campos de evidência se eles vieram via page Playwright.
 * Retorna step com campos normalizados + resultado de validação.
 */
async function executeAndEnrichStep(stepSpec = {}, playwrightPage = null, options = {}) {
  const journeyId = options.journeyId || stepSpec.journeyId || '';
  const blocking = isBlockingJourney(journeyId);
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  const stepId = stepSpec.id || stepSpec.stepId || `step-${Date.now()}`;

  let screenshotBefore = stepSpec.screenshotBefore || null;
  let screenshotAfter = stepSpec.screenshotAfter || null;
  let url = stepSpec.url || stepSpec.page || stepSpec.route || null;
  const actionType = resolveActionType(stepSpec.actionType || stepSpec.action || stepSpec.type || 'unknown');
  const operationalContract = getOperationalStepContract(stepId);
  const timestamp = stepSpec.timestamp || stepSpec.startedAt || new Date().toISOString();
  let domSnapshot = stepSpec.domSnapshot || null;
  let networkEvents = stepSpec.networkEvents || [];
  const selectorUsed = stepSpec.selectorUsed || stepSpec.selector || stepSpec.dataTestId || null;
  const evidenceId = stepSpec.evidenceId || makeEvidenceId({ ...stepSpec, id: stepId }, options);
  let mutationLinkage = null;
  let sideEffectLinkage = null;
  let snapshotDiff = null;
  let stepResult = stepSpec.stepResult || null;
  let status = stepSpec.status || 'executed';
  const mutationExpected = isMutationExpectedStep(stepSpec);
  let beforeStepSnapshot = null;
  let afterStepSnapshot = null;
  let incrementalDiff = null;
  const networkCapture = startNetworkCapture(playwrightPage);

  try {
    assertOperationalCondition(
      stepSpec?.mutationLinkage?.source !== 'stateMutation',
      {
        reason: 'state_mutation_not_allowed_as_step_proof',
        journeyId,
        stepId,
      }
    );

    assertOperationalCondition(
      executionMode === 'diagnostic' || stepSpec?.mutationLinkage == null,
      {
        reason: 'mutation_linkage_declarative_not_allowed',
        journeyId,
        stepId,
      }
    );

    assertOperationalCondition(!blocking || executionMode === 'diagnostic' || Boolean(playwrightPage), {
      reason: 'page_null_blocking_journey',
      journeyId,
      stepId,
    });

    beforeStepSnapshot = await collectStepBeforeSnapshot(stepSpec, options);

    // Se temos page Playwright, coletar evidências reais
    if (playwrightPage && typeof playwrightPage.screenshot === 'function') {
      try {
        if (!screenshotBefore) {
          const buf = await playwrightPage.screenshot({ type: 'png', fullPage: false });
          screenshotBefore = `data:image/png;base64,${buf.toString('base64')}`;
        }
      } catch (err) {
        assertOperationalCondition(!blocking, {
          reason: 'screenshot_before_capture_failed',
          journeyId,
          stepId,
          error: err.message,
        });
      }

      try {
        if (!url) url = playwrightPage.url();
      } catch (err) {
        assertOperationalCondition(!blocking, {
          reason: 'step_url_unavailable',
          journeyId,
          stepId,
          error: err.message,
        });
      }

      // Executa ação do step
      if (typeof stepSpec.execute === 'function') {
        try {
          await stepSpec.execute(playwrightPage);
        } catch (err) {
          networkEvents = networkCapture.stop();
          const blockingError = err instanceof BlockingOperationalError
            ? err
            : new BlockingOperationalError(err?.message || 'step_execution_failed', {
              journeyId,
              stepId,
              error: err.message,
            });
          const enriched = {
            ...stepSpec,
            id: stepId,
            screenshotBefore,
            screenshotAfter: null,
            url,
            actionType,
            timestamp,
            domSnapshot,
            networkEvents,
            selectorUsed,
            evidenceId,
            mutationLinkage: null,
            sideEffectLinkage: null,
            snapshotDiff: null,
            mutationExpected,
            beforeStepSnapshot,
            afterStepSnapshot: null,
            incrementalDiff: null,
            stepResult: {
              status: 'failed',
              error: blockingError.reason || err.message,
              blockingAssertion: true,
              metadata: blockingError.metadata || null,
            },
            error: blockingError.reason || err.message,
            status: 'failed',
            domAfter: domSnapshot,
          };
          const validation = validateStepEvidence(enriched, journeyId, { executionMode });
          return {
            step: enriched,
            validation,
            executed: true,
            failed: true,
            goNoGo: blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
          };
        }
      }

      // Coleta evidências após execução
      try {
        const buf = await playwrightPage.screenshot({ type: 'png', fullPage: false });
        screenshotAfter = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (err) {
        assertOperationalCondition(!blocking, {
          reason: 'screenshot_after_capture_failed',
          journeyId,
          stepId,
          error: err.message,
        });
      }

      try {
        url = playwrightPage.url();
      } catch (err) {
        assertOperationalCondition(!blocking, {
          reason: 'step_url_unavailable_after_execution',
          journeyId,
          stepId,
          error: err.message,
        });
      }

      try {
        const content = await playwrightPage.content();
        domSnapshot = content ? content.slice(0, 4096) : null;
      } catch (err) {
        assertOperationalCondition(!blocking, {
          reason: 'dom_snapshot_capture_failed',
          journeyId,
          stepId,
          error: err.message,
        });
      }

      networkEvents = networkCapture.stop();
    }

    if (!Array.isArray(networkEvents) || networkEvents.length === 0) {
      networkEvents = Array.isArray(stepSpec.networkEvents) ? stepSpec.networkEvents : [];
    }

    afterStepSnapshot = await collectStepAfterSnapshot(stepSpec, {
      ...stepSpec,
      id: stepId,
      actionType,
      networkEvents,
      screenshotBefore,
      screenshotAfter,
      url,
      domSnapshot,
      selectorUsed,
      evidenceId,
      mutationLinkage: null,
      sideEffectLinkage: null,
      snapshotDiff: null,
    }, options);

    incrementalDiff = computeIncrementalStepDiff({
      step: {
        ...stepSpec,
        id: stepId,
        actionType,
        mutationExpected,
      },
      beforeStepSnapshot,
      afterStepSnapshot,
    });

    mutationLinkage = buildMutationLinkage({ ...stepSpec, id: stepId }, {
      ...options,
      executionMode,
      incrementalDiff,
    });

    // Blocking journeys: mutational steps require step-scoped network evidence.
    if (blocking && mutationExpected && networkEvents.length === 0) {
      assertOperationalCondition(false, {
        reason: 'network_events_missing',
        journeyId,
        stepId,
        actionType,
      });
    }

    sideEffectLinkage = buildSideEffectLinkage({ ...stepSpec, id: stepId }, {
      ...options,
      executionMode,
      incrementalDiff,
    }, mutationLinkage);
    snapshotDiff = buildSnapshotDiff({ ...stepSpec, id: stepId }, {
      ...options,
      incrementalDiff,
      beforeStepSnapshot,
      afterStepSnapshot,
    });

    const evidenceClassification =
      executionMode === 'diagnostic' || mutationLinkage?.evidenceClassification === 'diagnostic_only'
        ? 'diagnostic_only'
        : 'operational';

    status = stepSpec.status || 'executed';
    stepResult = stepResult || {
      status: status === 'failed' ? 'failed' : 'success',
      blocking,
    };

    const enriched = {
      ...stepSpec,
      id: stepId,
      screenshotBefore,
      screenshotAfter,
      url,
      actionType,
      timestamp,
      domSnapshot,
      domAfter: domSnapshot,
      networkEvents: Array.isArray(networkEvents) ? networkEvents : [],
      selectorUsed,
      evidenceId,
      mutationLinkage,
      sideEffectLinkage,
      snapshotDiff: incrementalDiff?.diff || snapshotDiff,
      mutationExpected,
      beforeStepSnapshot,
      afterStepSnapshot,
      incrementalDiff,
      evidenceClassification,
      observedMutations: Array.isArray(incrementalDiff?.observedMutations)
        ? incrementalDiff.observedMutations
        : [],
      observedSideEffects: Array.isArray(incrementalDiff?.observedSideEffects)
        ? incrementalDiff.observedSideEffects
        : [],
      stepResult,
      status,
    };

    const validation = validateStepEvidence(enriched, journeyId, { executionMode });
    assertOperationalCondition(!blocking || executionMode === 'diagnostic' || validation.valid, {
      reason: 'blocking_step_missing_evidence',
      journeyId,
      stepId,
      missingEvidence: validation.missingEvidence,
    });

    // ── PASSO 2: validateStepExecutionProof (step-time, sem afterSnapshot) ──
    // Valida browser action + network proof — NÃO tenta mutation/side effect proof.
    const stepExecutionProof = validateStepExecutionProof(enriched, {
      isBlockingJourney: blocking,
      executionMode,
      journeyId,
    });

    if (!stepExecutionProof.valid && blocking && executionMode !== 'diagnostic') {
      assertOperationalCondition(false, {
        reason: 'blocking_step_execution_proof_failed',
        journeyId,
        stepId,
        actionType,
        proofBlockers: stepExecutionProof.blockers,
        goNoGo: 'NO_GO',
      });
    }

    const stepWithProof = {
      ...enriched,
      stepExecutionProof,
      // Post-state proof é anexado apenas depois de afterSnapshot existir.
      postStateProof: null,
      proofChain: {
        browserAction: Boolean(enriched.selectorUsed || enriched.screenshotAfter),
        networkProof: stepExecutionProof.networkProof?.valid ?? true,
        screenshotBefore: Boolean(enriched.screenshotBefore),
        screenshotAfter: Boolean(enriched.screenshotAfter),
        domCaptured: Boolean(enriched.domSnapshot || enriched.domAfter),
        urlCaptured: Boolean(enriched.url),
        snapshotDiff: incrementalDiff?.changed ?? null,
        observedMutations: incrementalDiff?.observedMutations || [],
        observedSideEffects: incrementalDiff?.observedSideEffects || [],
        mutationCount: incrementalDiff?.mutationCount || 0,
        finalStateProof: Boolean(afterStepSnapshot),
        stepExecutionValid: stepExecutionProof.valid ?? true,
        postStateValid: null,
        evidenceClassification,
        complete: null,
      },
    };

    const failed =
      (!validation.valid && blocking) ||
      (!stepExecutionProof.valid && blocking);

    const goNoGo =
      (blocking && (!validation.valid || !stepExecutionProof.valid))
        ? executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO'
        : null;

    return {
      step: stepWithProof,
      validation,
      stepExecutionProof,
      postStateProof: null,
      executed: true,
      failed,
      goNoGo,
    };
  } catch (err) {
    const blockingError = err instanceof BlockingOperationalError
      ? err
      : new BlockingOperationalError(err?.message || 'step_execution_failed', {
        journeyId,
        stepId,
        error: err?.message || String(err),
      });

    networkEvents = networkCapture.stop();
    const evidenceClassification = executionMode === 'diagnostic' ? 'diagnostic_only' : 'operational';
    const failedStep = {
      ...stepSpec,
      id: stepId,
      screenshotBefore,
      screenshotAfter,
      url,
      actionType,
      timestamp,
      domSnapshot,
      networkEvents: Array.isArray(networkEvents) ? networkEvents : [],
      selectorUsed,
      evidenceId,
      mutationLinkage,
      sideEffectLinkage,
      snapshotDiff,
      mutationExpected,
      beforeStepSnapshot,
      afterStepSnapshot,
      incrementalDiff,
      evidenceClassification,
      stepResult: {
        status: 'failed',
        error: blockingError.reason,
        blockingAssertion: true,
        metadata: blockingError.metadata || null,
      },
      error: blockingError.reason,
      status: 'failed',
      domAfter: domSnapshot,
    };

    const validation = validateStepEvidence(failedStep, journeyId, { executionMode });
    return {
      step: failedStep,
      validation,
      executed: true,
      failed: true,
      goNoGo: blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
    };
  }
}

async function executeStep(stepSpec = {}, playwrightPage = null, options = {}) {
  return executeAndEnrichStep(stepSpec, playwrightPage, options);
}

/**
 * Executa array de steps e para em NO_GO no primeiro step bloqueante sem evidência
 * (em jornada blocking).
 */
async function executeOperationalSteps(stepSpecs = [], playwrightPage = null, options = {}) {
  const journeyId = options.journeyId || '';
  const blocking = isBlockingJourney(journeyId);
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  const results = [];
  let goNoGo = null;

  for (const stepSpec of stepSpecs) {
    const result = await executeAndEnrichStep(stepSpec, playwrightPage, { journeyId, executionMode, ...options });
    results.push(result);

    if ((result.goNoGo === 'NO_GO' || result.goNoGo === 'REVIEW') && blocking) {
      goNoGo = result.goNoGo;
      break; // Para imediatamente em jornada blocking
    }
  }

  const allBlockers = results.flatMap((r) => r.validation?.blockers || []);

  return {
    steps: results.map((r) => r.step),
    stepResults: results,
    goNoGo: goNoGo || (allBlockers.some((b) => b.blocking) ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null),
    totalBlockers: allBlockers.length,
    blockers: allBlockers,
    stepsExecuted: results.length,
    stepsTotal: stepSpecs.length,
  };
}

/**
 * Valida TODA a fase post-state da jornada após afterSnapshot existir.
 *
 * Pipeline esperado:
 *   executeOperationalSteps() -> collectAfterSnapshot() -> validateJourneyPostStateProofs()
 */
function validateJourneyPostStateProofs({
  beforeSnapshot = null,
  afterSnapshot = null,
  executedSteps = [],
  replay = {},
  journeyContext = {},
} = {}) {
  const journeyId = journeyContext.journeyId || replay.journeyId || '';
  const executionMode = String(journeyContext.executionMode || 'operational_go').toLowerCase();
  const blocking = Boolean(
    journeyContext.isBlockingJourney !== undefined
      ? journeyContext.isBlockingJourney
      : isBlockingJourney(journeyId)
  );

  const blockers = [];
  const journeyDiff = computeRealSnapshotDiff(beforeSnapshot, afterSnapshot);

  if (afterSnapshot == null) {
    blockers.push({
      reason: 'replay_final_missing_after_snapshot',
      journeyId,
    });
  }

  if (journeyDiff == null) {
    blockers.push({
      reason: 'replay_final_missing_snapshot_diff',
      journeyId,
    });
  }

  if (journeyDiff && journeyDiff.changed === false) {
    blockers.push({
      reason: 'replay_final_snapshot_unchanged',
      journeyId,
    });
  }

  if (replay?.snapshotDiff == null) {
    blockers.push({
      reason: 'replay_final_missing_snapshot_diff',
      journeyId,
    });
  }

  const enrichedSteps = (Array.isArray(executedSteps) ? executedSteps : []).map((step) => {
    const stepId = step?.id || step?.stepId || 'unknown';
    const actionType = step?.actionType || 'unknown';
    const semanticContract = getOperationalStepContract(stepId);
    const expectedMutations = Array.isArray(semanticContract?.expectedMutations)
      ? semanticContract.expectedMutations
      : [];
    const expectedSideEffects = Array.isArray(semanticContract?.expectedSideEffects)
      ? semanticContract.expectedSideEffects
      : [];

    const stepExecutionProof = step?.stepExecutionProof || validateStepExecutionProof(step, {
      isBlockingJourney: blocking,
      executionMode,
      journeyId,
    });

    if (!stepExecutionProof?.networkProof?.valid && !stepExecutionProof?.networkProof?.noContract) {
      blockers.push({
        reason: 'replay_step_missing_network_proof',
        journeyId,
        stepId,
        actionType,
      });
    }

    if (executionMode !== 'diagnostic' && step?.mutationLinkage?.correlatedBy === 'journey_transition') {
      blockers.push({
        reason: 'operational_journey_transition_not_allowed',
        stepId,
        actionType,
      });
    }

    if (step?.mutationLinkage?.source === 'stateMutation') {
      blockers.push({
        reason: 'state_mutation_not_allowed_as_step_proof',
        stepId,
        actionType,
      });
    }

    const postStateProof = validatePostStateProof({
      beforeSnapshot: step?.beforeStepSnapshot || null,
      afterSnapshot: step?.afterStepSnapshot || null,
      step,
      incrementalDiff: step?.incrementalDiff || null,
      journeyContext: {
        journeyId,
        executionMode,
        isBlockingJourney: blocking,
      },
    });

    const observedMutations = postStateProof.observedMutations || [];
    const observedSideEffects = postStateProof.observedSideEffects || [];
    const mutationProvenance = computeMutationProvenance({
      step,
      observedMutations,
      beforeStepSnapshot: step?.beforeStepSnapshot || null,
      afterStepSnapshot: step?.afterStepSnapshot || null,
    });

    const matchedNetworkEvent = matchExpectedNetworkEvent(stepId, Array.isArray(step?.networkEvents) ? step.networkEvents : []);
    const networkCorrelation = matchedNetworkEvent
      ? [{
          method: matchedNetworkEvent.method || null,
          url: matchedNetworkEvent.url || null,
          status: matchedNetworkEvent.status || null,
          correlatedBy: 'expected_network_event',
        }]
      : [];

    const correlatedPostState = {
      ...postStateProof,
      diff: postStateProof.diff || null,
      observedMutations,
      observedSideEffects,
      mutationProvenance,
      networkCorrelation,
      mutationCount: observedMutations.length,
      finalStateProof: Boolean(step?.afterStepSnapshot),
    };

    if (semanticContract?.mutationExpected === true) {
      const invalidProvenance = mutationProvenance.filter((record) => record?.valid !== true);
      if (invalidProvenance.length > 0) {
        blockers.push({
          reason: 'post_state_provenance_invalid',
          stepId,
          actionType,
          details: invalidProvenance.map((record) => ({
            mutation: record?.mutation || null,
            reason: record?.reason || 'unknown',
          })),
        });
      }
    }

    if (observedMutations.length > 0 && observedSideEffects.length === 0) {
      blockers.push({
        reason: 'post_state_mutation_without_side_effect',
        stepId,
        actionType,
      });
    }

    // Correlação obrigatória baseada no contrato semântico do step.
    if (semanticContract?.mutationExpected === true) {
      const missingMutations = expectedMutations.filter(
        (mutation) => !observedMutations.some((observed) => String(observed) === String(mutation))
      );

      const missingSideEffects = expectedSideEffects.filter(
        (sideEffect) => !observedSideEffects.some((observed) => String(observed) === String(sideEffect))
      );

      if (missingMutations.length > 0) {
        blockers.push({
          reason: 'correlation_expected_mutations_missing',
          stepId,
          actionType,
          expectedMutations,
          observedMutations,
          missingMutations,
        });
      }

      if (missingSideEffects.length > 0) {
        blockers.push({
          reason: 'correlation_expected_side_effects_missing',
          stepId,
          actionType,
          expectedSideEffects,
          observedSideEffects,
          missingSideEffects,
        });
      }
    }

    return appendProofChainToReplay(step, stepExecutionProof, correlatedPostState);
  });

  const postStateBlockers = enrichedSteps.flatMap((step) => step?.postStateProof?.blockers || []);
  blockers.push(...postStateBlockers);

  const valid = blockers.length === 0;
  const goNoGo = valid ? null : (blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null);

  const summarySteps = enrichedSteps.map((step) => step?.postStateProof || {});
  const consolidatedObservedMutations = Array.from(new Set(
    summarySteps.flatMap((proof) => Array.isArray(proof?.observedMutations) ? proof.observedMutations : [])
  ));
  const consolidatedObservedSideEffects = Array.from(new Set(
    summarySteps.flatMap((proof) => Array.isArray(proof?.observedSideEffects) ? proof.observedSideEffects : [])
  ));
  const consolidatedMutationProvenance = summarySteps.flatMap((proof) =>
    Array.isArray(proof?.mutationProvenance) ? proof.mutationProvenance : []
  );
  const consolidatedNetworkCorrelation = summarySteps.flatMap((proof) =>
    Array.isArray(proof?.networkCorrelation) ? proof.networkCorrelation : []
  );

  return {
    valid,
    goNoGo,
    blockers,
    steps: enrichedSteps,
    postStateSummary: {
      summaryBasis: 'step_consolidated',
      stepsChecked: enrichedSteps.length,
      observedMutations: consolidatedObservedMutations,
      observedSideEffects: consolidatedObservedSideEffects,
      mutationProvenance: consolidatedMutationProvenance,
      networkCorrelation: consolidatedNetworkCorrelation,
      mutationCount: consolidatedObservedMutations.length,
      finalStateProof: Boolean(afterSnapshot),
    },
  };
}

/**
 * Classifica evidência de um step para exibição na UI de auditoria.
 */
function classifyStepEvidenceForAudit(step = {}, journeyId = '', options = {}) {
  const executionMode = String(options.executionMode || 'operational_go').toLowerCase();
  const validation = validateStepEvidence(step, journeyId, { executionMode });

  const evidenceStatus = validation.valid
    ? 'complete'
    : validation.missingEvidence.length <= 2
      ? 'partial'
      : 'missing';

  return {
    stepId: step?.id || 'unknown',
    actionType: step?.actionType || step?.action || step?.type || 'unknown',
    url: step?.url || null,
    timestamp: step?.timestamp || null,
    selectorUsed: step?.selectorUsed || step?.selector || null,
    evidenceId: step?.evidenceId || null,
    evidenceContract: validation.evidenceContract,
    requiredEvidence: validation.requiredEvidence || [],
    observedEvidence: validation.observedEvidence || [],
    screenshotBefore: step?.screenshotBefore || null,
    screenshotAfter: step?.screenshotAfter || null,
    domSnapshot: step?.domSnapshot ? step.domSnapshot.slice(0, 256) : null,
    networkEventsCount: Array.isArray(step?.networkEvents) ? step.networkEvents.length : 0,
    mutationLinkage: step?.mutationLinkage || null,
    sideEffectLinkage: step?.sideEffectLinkage || null,
    snapshotDiff: step?.snapshotDiff || null,
    missingEvidence: validation.missingEvidence,
    evidenceStatus,
    blockers: validation.blockers,
    blocker: validation.blockers.length > 0 ? validation.blockers[0] : null,
    goNoGo: validation.goNoGo,
  };
}

/**
 * Helper legado diagnostic-only com afterSnapshot fornecido externamente.
 *
 * O pipeline operacional final não deve usar esta função. Em operational_go ela
 * falha imediatamente para impedir proof fora da ordem temporal correta.
 *
 * @param {object} stepSpec - spec do step
 * @param {object} playwrightPage - página Playwright
 * @param {object} options - { journeyId, executionMode, beforeSnapshot, afterSnapshot }
 * @returns {Promise<object>} step diagnóstico enriquecido com proofChain completo
 */
async function executeAndEnrichStepWithPostStateProof(stepSpec, playwrightPage, options = {}) {
  const { journeyId = '', executionMode = 'operational_go', beforeSnapshot = null } = options;
  if (String(executionMode || 'operational_go').toLowerCase() !== 'diagnostic') {
    throw new BlockingOperationalError('legacy_post_state_helper_not_allowed_operational_go', {
      journeyId,
      stepId: stepSpec?.id || stepSpec?.stepId || null,
    });
  }

  // Diagnostic-only: executa o step e deixa o executor coletar o diff incremental.
  const result = await executeAndEnrichStep(stepSpec, playwrightPage, {
    journeyId,
    executionMode,
    beforeSnapshot,
    afterSnapshot: null,
  });

  // Diagnostic-only: permite anexar post-state externo sem participar do GO operacional.
  if (options.afterSnapshot != null) {
    const blocking = isBlockingJourney(journeyId);
    const postStateProof = validatePostStateProof({
      beforeSnapshot: result.step?.beforeStepSnapshot || beforeSnapshot,
      afterSnapshot: result.step?.afterStepSnapshot || options.afterSnapshot,
      step: result.step,
      incrementalDiff: result.step?.incrementalDiff || null,
      journeyContext: { isBlockingJourney: blocking, executionMode, journeyId },
    });

    const stepWithProof = appendProofChainToReplay(
      result.step,
      result.stepExecutionProof || {},
      postStateProof,
    );

    return {
      ...result,
      step: stepWithProof,
      postStateProof,
    };
  }

  return result;
}

module.exports = {
  executeStep,
  validateStepEvidence,
  validateReplayStepsEvidence,
  executeAndEnrichStep,
  executeAndEnrichStepWithPostStateProof,
  executeOperationalSteps,
  validateJourneyPostStateProofs,
  classifyStepEvidenceForAudit,
  validateEvidenceByContract,
  resolveEvidenceContract,
  isBlockingJourney,
  BLOCKING_JOURNEYS,
  collectStepBeforeSnapshot,
  collectStepAfterSnapshot,
  computeIncrementalStepDiff,
  // exports do proof pipeline para uso externo
  validateStepExecutionProof,
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
};
