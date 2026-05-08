'use strict';

/**
 * operationalStepExecutor.js
 *
 * Executor de steps operacionais browser-first.
 *
 * Pipeline de prova temporalmente correto:
 *   1. executeStep()                   — browser action
 *   2. validateStepExecutionProof()    — browser + network (step-time)
 *   3. collectAfterSnapshot()          — pós execução
 *   4. computeRealSnapshotDiff()       — diff real
 *   5. deriveObservedMutations(diff)   — mutações REAIS do diff
 *   6. deriveObservedSideEffects(diff) — side effects REAIS do diff
 *   7. validatePostStateProof()        — prova de estado pós-step
 *   8. appendProofChainToReplay()      — proof chain completa
 */

const { assertOperationalCondition, BlockingOperationalError } = require('./operationalAssertions');
const {
  validateEvidenceByContract,
  resolveActionType,
  resolveEvidenceContract,
} = require('../../../qa/evidence/stepEvidenceContracts');
const { validateStepExecutionProof } = require('../../../qa/evidence/stepExecutionProofValidator');
const { computeRealSnapshotDiff } = require('../../../qa/evidence/evidenceProofValidator');
const {
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
} = require('../../../qa/evidence/postStateProofValidator');

const BLOCKING_JOURNEYS = ['support_ticket_flow', 'fitness_customer_checkin'];

/**
 * Verifica se uma jornada é blocking.
 */
function isBlockingJourney(journeyId = '') {
  const id = String(journeyId).toLowerCase();
  return (
    BLOCKING_JOURNEYS.includes(id)
    || id.includes('support')
    || id.includes('fitness')
    || id.includes('checkin')
  );
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
  const explicit = step?.mutationLinkage || step?.mutation || options.mutationLinkage || null;
  if (explicit) return explicit;
  if (options.stateMutation?.valid && Number(options.stateMutation?.mutationCount || 0) > 0) {
    return {
      replayId: options.replayId || step?.replayId || null,
      executionId: options.executionId || step?.executionId || null,
      stepId: step?.id || step?.stepId || null,
      mutationCount: Number(options.stateMutation.mutationCount || 0),
      observedSideEffects: Array.isArray(options.stateMutation?.observedSideEffects)
        ? options.stateMutation.observedSideEffects
        : [],
      correlatedBy: 'journey_transition',
    };
  }
  return null;
}

function buildSideEffectLinkage(step = {}, options = {}, mutationLinkage = null) {
  const explicit = step?.sideEffectLinkage || options.sideEffectLinkage || null;
  if (explicit) return explicit;

  const expectedFromMutation = Array.isArray(mutationLinkage?.expectedSideEffects)
    ? mutationLinkage.expectedSideEffects
    : [];
  const observedFromState = Array.isArray(options?.stateMutation?.observedSideEffects)
    ? options.stateMutation.observedSideEffects
    : [];

  if (expectedFromMutation.length === 0 && observedFromState.length === 0) {
    return null;
  }

  return {
    expectedSideEffects: expectedFromMutation,
    observedSideEffects: observedFromState,
    correlatedBy: mutationLinkage?.correlatedBy || 'side_effect_inference',
  };
}

function buildSnapshotDiff(step = {}, options = {}) {
  const explicit = step?.snapshotDiff || options?.snapshotDiff || null;
  if (explicit) return explicit;

  if (options?.stateMutation) {
    return {
      mutationCount: Number(options.stateMutation?.mutationCount || 0),
      sideEffects: Array.isArray(options.stateMutation?.sideEffects)
        ? options.stateMutation.sideEffects
        : [],
      observedSideEffects: Array.isArray(options.stateMutation?.observedSideEffects)
        ? options.stateMutation.observedSideEffects
        : [],
      valid: options.stateMutation?.valid === true,
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
  const timestamp = stepSpec.timestamp || stepSpec.startedAt || new Date().toISOString();
  let domSnapshot = stepSpec.domSnapshot || null;
  let networkEvents = stepSpec.networkEvents || [];
  const selectorUsed = stepSpec.selectorUsed || stepSpec.selector || stepSpec.dataTestId || null;
  const evidenceId = stepSpec.evidenceId || makeEvidenceId({ ...stepSpec, id: stepId }, options);
  let mutationLinkage = buildMutationLinkage({ ...stepSpec, id: stepId }, options);
  let sideEffectLinkage = buildSideEffectLinkage({ ...stepSpec, id: stepId }, options, mutationLinkage);
  let snapshotDiff = buildSnapshotDiff({ ...stepSpec, id: stepId }, options);
  let stepResult = stepSpec.stepResult || null;
  let status = stepSpec.status || 'executed';
  const networkCapture = startNetworkCapture(playwrightPage);

  try {
    assertOperationalCondition(!blocking || executionMode === 'diagnostic' || Boolean(playwrightPage), {
      reason: 'page_null_blocking_journey',
      journeyId,
      stepId,
    });

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
            mutationLinkage,
            sideEffectLinkage,
            snapshotDiff,
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

    mutationLinkage = buildMutationLinkage({ ...stepSpec, id: stepId }, {
      ...options,
      mutationLinkage,
    });

    // Blocking journeys: step with expected mutations requires network evidence
    if (blocking && Number(mutationLinkage?.mutationCount || 0) > 0 && networkEvents.length === 0) {
      assertOperationalCondition(false, {
        reason: 'network_events_missing',
        journeyId,
        stepId,
        actionType,
      });
    }

    sideEffectLinkage = buildSideEffectLinkage({ ...stepSpec, id: stepId }, options, mutationLinkage);
    snapshotDiff = buildSnapshotDiff({ ...stepSpec, id: stepId }, options);

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
      snapshotDiff,
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
        snapshotDiff: null,
        observedMutations: [],
        observedSideEffects: [],
        mutationCount: 0,
        finalStateProof: false,
        stepExecutionValid: stepExecutionProof.valid ?? true,
        postStateValid: null,
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
  const journeyObservedMutations = deriveObservedMutations(journeyDiff);
  const journeyObservedSideEffects = deriveObservedSideEffects(journeyDiff);

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

    const postStateProof = validatePostStateProof({
      beforeSnapshot,
      afterSnapshot,
      step,
      journeyContext: {
        journeyId,
        executionMode,
        isBlockingJourney: blocking,
      },
    });

    const observedMutations = (postStateProof.observedMutations || []).length > 0
      ? postStateProof.observedMutations
      : journeyObservedMutations;
    const observedSideEffects = (postStateProof.observedSideEffects || []).length > 0
      ? postStateProof.observedSideEffects
      : journeyObservedSideEffects;

    const correlatedPostState = {
      ...postStateProof,
      diff: postStateProof.diff || journeyDiff,
      observedMutations,
      observedSideEffects,
      mutationCount: observedMutations.length,
      finalStateProof: Boolean(afterSnapshot),
    };

    if (observedMutations.length > 0 && observedSideEffects.length === 0) {
      blockers.push({
        reason: 'post_state_mutation_without_side_effect',
        stepId,
        actionType,
      });
    }

    // Correlação obrigatória: reply_ticket -> message_created -> audit/crm
    if (actionType === 'type_and_send' || stepId === 'step_reply_ticket') {
      if (!observedMutations.includes('message_created')) {
        blockers.push({ reason: 'correlation_reply_ticket_missing_message_created', stepId, actionType });
      }
      if (!observedSideEffects.includes('audit_log_created')) {
        blockers.push({ reason: 'correlation_reply_ticket_missing_audit_log', stepId, actionType });
      }
      if (!observedSideEffects.includes('crm_updated')) {
        blockers.push({ reason: 'correlation_reply_ticket_missing_crm_updated', stepId, actionType });
      }
    }

    // Correlação obrigatória: checkin_submit -> attendance/access_event -> CRM journey
    if (actionType === 'checkin_submit' || stepId === 'step_assert_attendance') {
      if (!observedMutations.includes('attendance_created')) {
        blockers.push({ reason: 'correlation_checkin_missing_attendance_created', stepId, actionType });
      }
      if (!observedMutations.includes('access_event_created')
        && !observedSideEffects.includes('access_event_created')) {
        blockers.push({ reason: 'correlation_checkin_missing_access_event', stepId, actionType });
      }
      if (!observedSideEffects.includes('crm_journey_updated')) {
        blockers.push({ reason: 'correlation_checkin_missing_crm_journey', stepId, actionType });
      }
    }

    return appendProofChainToReplay(step, stepExecutionProof, correlatedPostState);
  });

  const postStateBlockers = enrichedSteps.flatMap((step) => step?.postStateProof?.blockers || []);
  blockers.push(...postStateBlockers);

  const valid = blockers.length === 0;
  const goNoGo = valid ? null : (blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null);

  return {
    valid,
    goNoGo,
    blockers,
    steps: enrichedSteps,
    postStateSummary: {
      snapshotDiff: journeyDiff,
      observedMutations: journeyObservedMutations,
      observedSideEffects: journeyObservedSideEffects,
      mutationCount: journeyObservedMutations.length,
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
 * Pipeline completo de prova com afterSnapshot fornecido externamente.
 *
 * Use esta função quando o orquestrador já tem before/afterSnapshot disponíveis
 * e quer executar o pipeline de 8 passos de uma só vez.
 *
 * @param {object} stepSpec - spec do step
 * @param {object} playwrightPage - página Playwright
 * @param {object} options - { journeyId, executionMode, beforeSnapshot, afterSnapshot }
 * @returns {Promise<object>} step enriquecido com proofChain completo
 */
async function executeAndEnrichStepWithPostStateProof(stepSpec, playwrightPage, options = {}) {
  const { journeyId = '', executionMode = 'operational_go', beforeSnapshot = null } = options;

  // Passos 1-2: executeStep + step-time proof (afterSnapshot=null, válido)
  const result = await executeAndEnrichStep(stepSpec, playwrightPage, {
    journeyId,
    executionMode,
    beforeSnapshot,
    afterSnapshot: null, // não temos ainda
  });

  // Se caller forneceu afterSnapshot, executa pós-state agora
  if (options.afterSnapshot != null) {
    const blocking = isBlockingJourney(journeyId);
    const postStateProof = validatePostStateProof({
      beforeSnapshot,
      afterSnapshot: options.afterSnapshot,
      step: result.step,
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
  // exports do proof pipeline para uso externo
  validateStepExecutionProof,
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
};
