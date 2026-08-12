const logger = require('../../utils/logger');
const replayNormalizationService = require('./replayNormalizationService');
const transitionInferenceService = require('./transitionInferenceService');
const operationalStateEngine = require('./operationalStateEngine');
const { validateEvidenceByContract } = require('../../../qa/evidence/stepEvidenceContracts');
const {
  getOperationalStepContract,
  getExpectedSideEffectsForStep,
  getJourneySteps,
  resolveJourneyId,
  matchExpectedNetworkEvent,
} = require('../../../qa/contracts/operationalStepRegistry');
const { validateReplayIntegrity } = require('./replayIntegrityService');

/**
 * Valida se replay é operacional real
 * Detecta:
 * - se replay acessou módulo real
 * - se replay mostrou jornada real (não mock)
 * - se replay mostrou usuário humano (não bot)
 * - se replay mostrou operação real (com consequências)
 * - se replay mostrou screenshots válidos
 */

/**
 * Valida se replay acessou módulo real (não apenas stubs)
 */
// Nota: /resource-bookings é a rota operacional real de reservas do workspace
// (api/modules/workspace/workspace.routes.js); URLs gravadas no replay carregam
// query string, por isso o lookahead aceita ?, / ou fim.
const OPERATIONAL_MODULE_PATTERN = /\/(support|fitness|access-control|calendar|bookings|orders|node-marketplace)(\/|$)|\/api\/(support|crm|access-control|fitness|calendar|bookings|node-marketplace)(\/|$)|\/resource-bookings(\?|\/|$)/i;
const DIAGNOSTIC_PAGE_PATTERN = /\/dev\/qa-waves(\/|$)|\/rpa-replays(\/|$)/i;

function toSnakeCase(value = '') {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

function normalizeJourneyId(value = '') {
  return resolveJourneyId(value) || String(value || '').toLowerCase();
}

function getEvidenceClassification(step = {}) {
  return String(step?.evidenceClassification || 'operational').toLowerCase();
}

function isOperationalEvidence(step = {}) {
  return getEvidenceClassification(step) === 'operational';
}

function partitionEvidenceSteps(steps = []) {
  const list = Array.isArray(steps) ? steps : [];
  const operationalSteps = list.filter(isOperationalEvidence);
  const diagnosticSteps = list.filter((step) => !isOperationalEvidence(step));
  return {
    operationalSteps,
    diagnosticSteps,
    hasOperationalEvidence: operationalSteps.length > 0,
    hasDiagnosticEvidence: diagnosticSteps.length > 0,
  };
}

function getReplayPostStateSummary(replay = {}) {
  return replay?.postStateSummary || replay?.postState?.postStateSummary || null;
}

function getMutationalOperationalSteps(replay = {}) {
  const operationalSteps = partitionEvidenceSteps(replay.steps).operationalSteps;
  return operationalSteps.filter((step) => {
    const stepId = step?.id || step?.stepId || null;
    const contract = getOperationalStepContract(stepId);
    return contract?.mutationExpected === true;
  });
}

function getSingleMutationalPostStateSummary(replay = {}) {
  const mutationalSteps = getMutationalOperationalSteps(replay);

  if (mutationalSteps.length !== 1) return null;
  return getReplayPostStateSummary(replay);
}

function getStepObservedMutations(step = {}) {
  if (Array.isArray(step?.observedMutations) && step.observedMutations.length > 0) {
    return step.observedMutations;
  }
  return Array.isArray(step?.postStateProof?.observedMutations)
    ? step.postStateProof.observedMutations
    : [];
}

function getStepMutationProvenance(step = {}) {
  if (Array.isArray(step?.mutationProvenance) && step.mutationProvenance.length > 0) {
    return step.mutationProvenance;
  }
  return Array.isArray(step?.postStateProof?.mutationProvenance)
    ? step.postStateProof.mutationProvenance
    : [];
}

function getStepNetworkCorrelation(step = {}) {
  if (Array.isArray(step?.networkCorrelation) && step.networkCorrelation.length > 0) {
    return step.networkCorrelation;
  }
  return Array.isArray(step?.postStateProof?.networkCorrelation)
    ? step.postStateProof.networkCorrelation
    : [];
}

function getSummaryMutationProvenanceForStep(replay = {}, step = {}) {
  const summary = getReplayPostStateSummary(replay);
  const summaryProvenance = Array.isArray(summary?.mutationProvenance)
    ? summary.mutationProvenance
    : [];
  if (summaryProvenance.length === 0) return [];

  const stepId = step?.id || step?.stepId || null;
  const filtered = stepId
    ? summaryProvenance.filter((record) => record?.originatingStepId === stepId)
    : [];

  if (filtered.length > 0) return filtered;

  return getMutationalOperationalSteps(replay).length === 1 ? summaryProvenance : [];
}

function getSummaryNetworkCorrelationForStep(replay = {}, step = {}) {
  const summary = getReplayPostStateSummary(replay);
  const summaryNetworkCorrelation = Array.isArray(summary?.networkCorrelation)
    ? summary.networkCorrelation
    : [];
  if (summaryNetworkCorrelation.length === 0) return [];

  const stepId = step?.id || step?.stepId || null;
  const matchedNetworkEvent = stepId
    ? matchExpectedNetworkEvent(stepId, summaryNetworkCorrelation)
    : null;

  if (matchedNetworkEvent) return [matchedNetworkEvent];

  return getMutationalOperationalSteps(replay).length === 1 ? summaryNetworkCorrelation : [];
}

function validateReplayStepEvidence(replay = {}) {
  const allSteps = Array.isArray(replay.steps) ? replay.steps : [];
  const { operationalSteps, diagnosticSteps } = partitionEvidenceSteps(allSteps);
  const steps = operationalSteps;
  const blockers = [];
  const journeyId = normalizeJourneyId(replay.journeyId);
  const isBlockingJourney = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyId);

  if (steps.length === 0 && diagnosticSteps.length > 0) {
    blockers.push({ reason: 'operational_evidence_missing', journeyId });
  }

  for (const [index, step] of steps.entries()) {
    const stepId = step?.id || `step-${index + 1}`;

    const validation = validateEvidenceByContract({
      actionType: step?.actionType || step?.action || step?.type,
      evidence: step,
      journeyContext: {
        journeyId,
        stepId,
        isBlockingJourney,
        executionMode: 'operational_go',
      },
    });

    if (!validation.valid) {
      blockers.push(
        ...validation.blockers.map((item) => ({
          ...item,
          reason: `replay_step_missing_${toSnakeCase(item.field)}`,
        }))
      );
    }
  }

  return {
    valid: blockers.length === 0,
    stepsChecked: steps.length,
    diagnosticStepsIgnored: diagnosticSteps.length,
    blockers,
  };
}

function validateMutationProvenanceCompleteness(replay = {}) {
  const steps = partitionEvidenceSteps(replay.steps).operationalSteps;
  const blockers = [];

  for (const [index, step] of steps.entries()) {
    const stepId = step?.id || `step-${index + 1}`;
    const actionType = step?.actionType || step?.action || step?.type || 'unknown';
    const contract = getOperationalStepContract(stepId);
    const observedMutations = getStepObservedMutations(step);
    const shouldRequireProvenance = contract
      ? contract.mutationExpected === true
      : observedMutations.length > 0;

    if (!shouldRequireProvenance) continue;

    if (!contract) {
      blockers.push({
        reason: 'operational_step_contract_missing',
        stepId,
        actionType,
      });
      continue;
    }

    const mutationProvenance = getStepMutationProvenance(step).length > 0
      ? getStepMutationProvenance(step)
      : getSummaryMutationProvenanceForStep(replay, step);

    if (mutationProvenance.length === 0) {
      blockers.push({
        reason: 'mutation_provenance_missing',
        stepId,
        actionType,
      });
      continue;
    }

    const provenanceByMutation = new Map();
    for (const record of mutationProvenance) {
      if (record && record.mutation) {
        provenanceByMutation.set(record.mutation, record);
      }
    }

    for (const mutation of observedMutations) {
      const record = provenanceByMutation.get(mutation);
      if (!record) {
        blockers.push({
          reason: 'mutation_provenance_entry_missing',
          stepId,
          actionType,
          mutation,
        });
        continue;
      }

      const missingFields = [];
      if (!record.originatingStepId) missingFields.push('originatingStepId');
      if (!record.originatingActionType) missingFields.push('originatingActionType');
      if (!record.originatingNetworkEvent) missingFields.push('originatingNetworkEvent');
      if (!Array.isArray(record.entityScope) || record.entityScope.length === 0) missingFields.push('entityScope');
      if (!record.beforeStepSnapshotHash && !record.beforeSnapshotHash) missingFields.push('beforeStepSnapshotHash');
      if (!record.afterStepSnapshotHash && !record.afterSnapshotHash) missingFields.push('afterStepSnapshotHash');

      if (missingFields.length > 0) {
        blockers.push({
          reason: 'mutation_provenance_incomplete',
          stepId,
          actionType,
          mutation,
          missingFields,
        });
      }

      if (record.valid !== true || record.reason) {
        blockers.push({
          reason: 'mutation_provenance_invalid',
          stepId,
          actionType,
          mutation,
          provenanceReason: record.reason || 'expected_network_event_not_found',
        });
      }

      if (record.correlatedBy !== 'network_linkage') {
        blockers.push({
          reason: 'mutation_provenance_non_deterministic',
          stepId,
          actionType,
          mutation,
          correlatedBy: record.correlatedBy || null,
        });
      }

      if (record.originatingActionType !== contract.actionType) {
        blockers.push({
          reason: 'originating_action_type_mismatch',
          stepId,
          actionType,
          mutation,
          expectedActionType: contract.actionType,
          actualActionType: record.originatingActionType || null,
        });
      }
    }
  }

  return {
    valid: blockers.length === 0,
    blockers,
  };
}

function validateOperationalSeedLinkage(replay = {}) {
  const journeyId = normalizeJourneyId(replay.journeyId);
  const isBlockingJourney = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyId);
  const seedEvidence = replay.seedEvidence || replay.metadata?.seedEvidence || null;
  const seedStatus = String(
    replay.operationalSeedStatus
    || replay.metadata?.operationalSeedStatus
    || seedEvidence?.status
    || ''
  ).toLowerCase();
  const blockers = [];

  if (!isBlockingJourney) {
    return {
      valid: true,
      journeyId,
      blockers,
    };
  }

  if (!seedEvidence) {
    blockers.push({ reason: 'operational_seed_missing', journeyId });
  }

  if (seedStatus && seedStatus !== 'ready' && seedStatus !== 'provisioned' && seedStatus !== 'ok') {
    blockers.push({ reason: 'operational_seed_not_ready', journeyId, status: seedStatus });
  }

  if (journeyId === 'support_ticket_flow') {
    const hasIds = Boolean(seedEvidence?.ticketId);
    if (!hasIds) blockers.push({ reason: 'support_seed_missing_ids', journeyId });
  }

  if (journeyId === 'fitness_customer_checkin') {
    const hasIds = Boolean(seedEvidence?.subjectId && seedEvidence?.membershipId && seedEvidence?.credentialId && seedEvidence?.deviceId);
    if (!hasIds) blockers.push({ reason: 'fitness_seed_missing_ids', journeyId });
  }

  return {
    valid: blockers.length === 0,
    journeyId,
    blockers,
  };
}

function validateJourneyOperationalFlow(replay = {}) {
  const journeyId = normalizeJourneyId(replay.journeyId);
  const blockers = [];
  const evidence = partitionEvidenceSteps(replay.steps);
  const steps = evidence.operationalSteps;
  const requiredSteps = Object.keys(getJourneySteps(journeyId) || {});
  const byStepId = new Map();
  for (const step of steps) {
    const stepId = step?.id || step?.stepId;
    if (stepId) byStepId.set(stepId, step);
  }

  for (const requiredStepId of requiredSteps) {
    if (!byStepId.has(requiredStepId)) {
      blockers.push({ reason: 'journey_required_step_missing', journeyId, stepId: requiredStepId });
    }
  }

  for (const step of steps) {
    const stepId = step?.id || step?.stepId || null;
    const contract = getOperationalStepContract(stepId);
    if (!contract) {
      blockers.push({ reason: 'operational_step_contract_missing', journeyId, stepId: stepId || 'unknown' });
      continue;
    }

    const stepActionType = step?.actionType || step?.action || step?.type || null;
    if (stepActionType !== contract.actionType) {
      blockers.push({
        reason: 'step_action_type_not_canonical',
        journeyId,
        stepId,
        expectedActionType: contract.actionType,
        actualActionType: stepActionType,
      });
    }

    if (step?.mutationLinkage?.correlatedBy === 'journey_transition') {
      blockers.push({ reason: 'operational_journey_transition_not_allowed', journeyId, stepId });
    }

    if (step?.mutationLinkage?.source === 'stateMutation') {
      blockers.push({ reason: 'state_mutation_not_allowed_as_step_proof', journeyId, stepId });
    }

    if (contract.networkProofRequired === true) {
      const networkEvent = matchExpectedNetworkEvent(stepId, Array.isArray(step?.networkEvents) ? step.networkEvents : []);
      if (!networkEvent) {
        blockers.push({ reason: 'expected_network_event_not_found', journeyId, stepId });
      }
    }

    if (contract.mutationExpected === true) {
      const observedMutations = Array.isArray(step?.observedMutations) ? step.observedMutations : [];
      const expectedMutations = Array.isArray(contract.expectedMutations) ? contract.expectedMutations : [];
      const expectedSideEffects = getExpectedSideEffectsForStep(stepId);
      const observedSideEffects = Array.isArray(step?.observedSideEffects) ? step.observedSideEffects : [];
      const provenance = Array.isArray(step?.mutationProvenance) ? step.mutationProvenance : [];

      const missingMutations = expectedMutations.filter((mutation) =>
        !observedMutations.some((item) => String(item) === String(mutation))
      );
      if (missingMutations.length > 0) {
        blockers.push({ reason: 'correlation_expected_mutations_missing', journeyId, stepId, missingMutations });
      }

      const missingSideEffects = expectedSideEffects.filter((sideEffect) =>
        !observedSideEffects.some((item) => String(item) === String(sideEffect))
      );
      if (missingSideEffects.length > 0) {
        blockers.push({ reason: 'correlation_expected_side_effects_missing', journeyId, stepId, missingSideEffects });
      }

      const invalidProvenance = provenance.filter((item) => item?.valid !== true || item?.reason || item?.correlatedBy !== 'network_linkage');
      if (invalidProvenance.length > 0) {
        blockers.push({ reason: 'mutation_provenance_invalid', journeyId, stepId });
      }
    }
  }

  return {
    valid: blockers.length === 0,
    journeyId,
    operationalStepsChecked: steps.length,
    diagnosticStepsIgnored: evidence.diagnosticSteps.length,
    blockers,
  };
}

function collectReplayPages(replay = {}) {
  const pages = new Set(Array.isArray(replay.rawPages) ? replay.rawPages : []);
  const items = [
    ...(Array.isArray(replay.events) ? replay.events : []),
    ...(Array.isArray(replay.steps) ? replay.steps : []),
    ...(Array.isArray(replay.screenshots) ? replay.screenshots : []),
  ];
  for (const item of items) {
    const value = item?.page || item?.route || item?.path || item?.url || item?.input?.url || item?.evidence?.url || item?.description;
    if (value) pages.add(String(value));
  }
  return Array.from(pages);
}

function validateReplayCompleteness(replay = {}) {
  const pages = collectReplayPages(replay);
  const operationalPages = pages.filter((page) => OPERATIONAL_MODULE_PATTERN.test(page));
  const diagnosticPages = pages.filter((page) => DIAGNOSTIC_PAGE_PATTERN.test(page));
  const onlyDiagnosticPages = pages.length > 0 && diagnosticPages.length === pages.length;
  const evidence = partitionEvidenceSteps(replay.steps);
  const stepEvidence = validateReplayStepEvidence(replay);
  const mutationProvenance = validateMutationProvenanceCompleteness(replay);
  const journeyFlow = validateJourneyOperationalFlow(replay);
  const seedLinkage = validateOperationalSeedLinkage(replay);
  const blockers = [];

  if (Number(replay.rawStepCount || 0) === 0) {
    blockers.push({ reason: 'replay_steps_empty' });
  }
  if (!evidence.hasOperationalEvidence && evidence.hasDiagnosticEvidence) {
    blockers.push({ reason: 'operational_evidence_missing' });
  }
  if (Number(replay.rawScreenshotCount || 0) === 0) {
    blockers.push({ reason: 'missing_operational_screenshots' });
  }
  if (operationalPages.length === 0) {
    blockers.push({ reason: 'replay_not_operational', details: { pagesVisited: pages } });
  }
  if (onlyDiagnosticPages) {
    blockers.push({ reason: 'replay_only_diagnostic_pages', details: { pagesVisited: pages } });
  }
  if (!stepEvidence.valid) {
    blockers.push(...stepEvidence.blockers);
  }
  if (!mutationProvenance.valid) {
    blockers.push(...mutationProvenance.blockers);
  }
  if (!journeyFlow.valid) {
    blockers.push(...journeyFlow.blockers);
  }
  if (!seedLinkage.valid) {
    blockers.push(...seedLinkage.blockers);
  }

  return {
    valid: blockers.length === 0,
    pagesVisited: pages,
    operationalPages,
    diagnosticPages,
    onlyDiagnosticPages,
    hasOperationalEvidence: evidence.hasOperationalEvidence,
    hasDiagnosticEvidence: evidence.hasDiagnosticEvidence,
    diagnosticStepsIgnored: evidence.diagnosticSteps.length,
    stepEvidence,
    mutationProvenance,
    journeyFlow,
    seedLinkage,
    blockers,
  };
}

function validateRealModuleAccess(replay = {}) {
  const accessed = [];
  const stubs = [];

  const events = replay.events || [];
  const pages = collectReplayPages(replay);
  for (const event of events) {
    const module = event.module || event.service || '';
    const isStub = module.includes('mock') || module.includes('stub') || module.includes('test');

    if (isStub) {
      stubs.push(module);
    } else if (module) {
      accessed.push(module);
    }
  }

  for (const page of pages) {
    if (OPERATIONAL_MODULE_PATTERN.test(page)) {
      accessed.push(page);
    }
  }

  const uniqueRealModules = [...new Set(accessed)];
  const isRealAccess =
    uniqueRealModules.length > 0
    && uniqueRealModules.some((m) => m !== 'qa' && m !== 'qa-waves')
    && pages.some((page) => OPERATIONAL_MODULE_PATTERN.test(page));

  return {
    isRealAccess,
    realModulesAccessed: uniqueRealModules,
    stubsUsed: [...new Set(stubs)],
    ratio: uniqueRealModules.length / (uniqueRealModules.length + stubs.length) || 0,
  };
}

/**
 * Valida se replay mostrou jornada real
 * (não apenas ciclos Q/A)
 */
function validateRealJourneyPath(replay = {}) {
  const events = replay.events || [];
  const pages = collectReplayPages(replay);
  const transitions = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (i > 0) {
      const prev = events[i - 1];
      if (prev.page && event.page && prev.page !== event.page) {
        transitions.push({ from: prev.page, to: event.page });
      }
    }
  }

  const uniquePages = [...new Set(pages)];
  const operationalPages = uniquePages.filter((page) => OPERATIONAL_MODULE_PATTERN.test(page));
  const onlyDiagnosticPages = uniquePages.length > 0 && uniquePages.every((page) => DIAGNOSTIC_PAGE_PATTERN.test(page));
  const isNonTrivia = operationalPages.length > 0 && !onlyDiagnosticPages;
  const hasForwardProgress =
    transitions.length > 0 && transitions.some((t) => t.from !== t.to);

  return {
    isRealJourney: isNonTrivia && (hasForwardProgress || operationalPages.length > 0),
    pagesVisited: uniquePages,
    operationalPages,
    onlyDiagnosticPages,
    transitions: transitions,
    journeyDepth: uniquePages.length,
  };
}

/**
 * Valida se replay mostrou usuário humano
 * (não determinístico, com hesitações, erros)
 */
function validateHumanBehavior(replay = {}) {
  const events = replay.events || [];
  const issues = [];

  // Detector: velocidade muito rápida
  if (events.length > 0) {
    const duration = replay.duration || 0;
    const avgEventTime = duration / events.length;
    if (avgEventTime < 100) {
      issues.push('event_timing_too_fast_for_human');
    }
  }

  // Detector: padrão muito regular
  const eventTypes = events.map((e) => e.type);
  const regex = eventTypes.join('');
  const repeatingPattern = /(.+)\1{3,}/.test(regex);
  if (repeatingPattern) {
    issues.push('repeating_pattern_suggests_bot');
  }

  // Detector: sem hesitação/retry
  const hasRetry = events.some((e) => e.retry === true || e.attempt > 1);
  if (!hasRetry && events.length > 5) {
    issues.push('no_retries_or_corrections');
  }

  // Detector: delays irregulares (humano tem hesitação)
  const hasDelays = events.some((e) => e.delay && e.delay > 500);
  if (!hasDelays) {
    issues.push('no_hesitation_delays');
  }

  const isHumanBehavior = issues.length === 0;
  return {
    isHumanBehavior,
    confidence: Math.max(0, 1 - issues.length * 0.25),
    issues,
  };
}

/**
 * Valida se replay mostrou operação real
 * (com consequências observáveis)
 */
function validateRealOperation(replay = {}) {
  const consequences = [];

  // Check 1: Data mutations
  if (replay.dataMutations && Object.keys(replay.dataMutations).length > 0) {
    consequences.push('data_mutations_observed');
  }

  // Check 2: State changes
  const events = replay.events || [];
  const stateChanges = events.filter((e) => e.stateChange === true);
  if (stateChanges.length > 0) {
    consequences.push('state_changes_observed');
  }

  // Check 3: Database writes
  if (events.some((e) => e.operation === 'write' || e.operation === 'insert')) {
    consequences.push('database_writes_observed');
  }

  // Check 4: External API calls
  if (events.some((e) => e.type === 'api_call' || e.isExternal === true)) {
    consequences.push('external_api_calls_observed');
  }

  // Check 5: Notifications/Events
  if (events.some((e) => e.type === 'notification' || e.eventEmitted === true)) {
    consequences.push('events_or_notifications_observed');
  }

  // Check 6: Audit trail
  if (replay.auditLog && replay.auditLog.length > 0) {
    consequences.push('audit_trail_created');
  }

  const isRealOperation = consequences.length >= 2; // Mínimo 2 consequências
  return {
    isRealOperation,
    consequencesObserved: consequences,
    count: consequences.length,
  };
}

/**
 * Valida se replay contém screenshots válidos
 */
function validateScreenshots(replay = {}) {
  const screenshots = replay.screenshots || [];
  const issues = [];

  if (screenshots.length === 0) {
    issues.push('no_screenshots');
    return { valid: false, issues, count: 0 };
  }

  // Validar cada screenshot
  for (const ss of screenshots) {
    if (!ss.path && !ss.data) {
      issues.push('screenshot_without_path_or_data');
    }
    if (!ss.timestamp) {
      issues.push('screenshot_without_timestamp');
    }
    if (!ss.description) {
      issues.push('screenshot_without_description');
    }
  }

  const hasCriticalScreenshots = screenshots.some((ss) => ss.critical === true || ss.type === 'validation');

  return {
    valid: issues.length === 0 && hasCriticalScreenshots,
    issues,
    count: screenshots.length,
    hasCritical: hasCriticalScreenshots,
  };
}

function inferObservedSideEffects(replay = {}) {
  const observed = new Set();
  const steps = Array.isArray(replay.steps) ? replay.steps : [];

  // PROVA ESTRUTURAL: derivar side effects dos dados de prova por step (não heurísticas textuais sobre entidades)
  for (const step of steps) {
    if (Array.isArray(step?.observedSideEffects)) {
      for (const se of step.observedSideEffects) {
        if (typeof se === 'string' && se.trim()) observed.add(se.trim());
      }
    }
  }

  // Audit log: dado estrutural do replay, não heurística
  if (Array.isArray(replay.auditLog) && replay.auditLog.length > 0) {
    observed.add('audit_log_created');
  }

  // Notificações: dado estrutural (campo emitido)
  const events = Array.isArray(replay.events) ? replay.events : [];
  for (const event of events) {
    const type = String(event?.type || '').toLowerCase();
    if (type === 'notification' || event.eventEmitted === true) {
      observed.add('notification_sent');
    }
  }

  return Array.from(observed);
}

function validateStateAwareReplay(replay = {}, options = {}) {
  const contracts = transitionInferenceService.loadTransitionContracts(options.transitionContracts);
  const inferred = transitionInferenceService.inferTransitionsFromReplayEvents(replay.events || [], { contracts });
  const observedSideEffects = inferObservedSideEffects(replay);

  const transitions = inferred.map((item) => {
    const contract = item.contract || {};
    return {
      journeyId: options.journeyId || replay.journeyId || contract.journeyId,
      transitionId: item.transitionId,
      action: item.action,
      initialState: replay.initialState || contract.initialState || options.initialState || null,
      transitionState: replay.transitionState || contract.expectedTransition || options.transitionState || null,
      finalState: replay.finalState || contract.finalState || options.finalState || null,
      beforeSnapshot: options.beforeSnapshot || replay.beforeSnapshot || { state: replay.initialState || contract.initialState || null },
      afterSnapshot: options.afterSnapshot || replay.afterSnapshot || { state: replay.finalState || contract.finalState || null },
      observedSideEffects,
      requiredSideEffects: contract.requiredSideEffects || [],
    };
  });

  const flowEvaluation = operationalStateEngine.evaluateOperationalStateFlow({
    transitions,
    journeyId: options.journeyId || replay.journeyId || null,
    transitionContracts: contracts,
  });

  const clickWithoutConsequence = (replay.userActions || []).length > 0
    && flowEvaluation.chain.coverage.operationalConsequenceCoverage === 0;

  return {
    valid: flowEvaluation.goNoGo === 'GO' && !clickWithoutConsequence,
    transitionsInferred: inferred,
    transitionsValidated: flowEvaluation.chain.validations.length,
    clickWithoutConsequence,
    coverage: flowEvaluation.chain.coverage,
    blockers: flowEvaluation.blockers,
    timeline: flowEvaluation.timeline,
    remediation: flowEvaluation.remediation,
  };
}

function replayHasDeterministicOperationalProof(replay = {}) {
  const { operationalSteps, hasOperationalEvidence } = partitionEvidenceSteps(replay.steps);
  if (!hasOperationalEvidence || operationalSteps.length === 0) return false;

  let hasMutationalOperationalStep = false;

  for (const step of operationalSteps) {
    const stepId = step?.id || step?.stepId || null;
    const contract = getOperationalStepContract(stepId);
    if (!contract) return false;

    if (contract.mutationExpected !== true) continue;
    hasMutationalOperationalStep = true;

    if (step?.incrementalDiff?.changed !== true) return false;
    if (step?.stepExecutionProof?.valid === false) return false;
    if (step?.postStateProof?.valid === false) return false;

    const observedMutations = getStepObservedMutations(step);
    const observedSideEffects = Array.isArray(step?.observedSideEffects) ? step.observedSideEffects : [];
    const expectedMutations = Array.isArray(contract.expectedMutations) ? contract.expectedMutations : [];
    const expectedSideEffects = getExpectedSideEffectsForStep(stepId);

    if (expectedMutations.some((mutation) => !observedMutations.includes(mutation))) return false;
    if (expectedSideEffects.some((sideEffect) => !observedSideEffects.includes(sideEffect))) return false;
    if (!matchExpectedNetworkEvent(stepId, Array.isArray(step?.networkEvents) ? step.networkEvents : [])) return false;

    const provenance = getStepMutationProvenance(step).length > 0
      ? getStepMutationProvenance(step)
      : getSummaryMutationProvenanceForStep(replay, step);
    if (provenance.length === 0) return false;
    if (provenance.some((record) => record?.valid !== true || record?.reason || record?.correlatedBy !== 'network_linkage')) {
      return false;
    }

    const networkCorrelation = getStepNetworkCorrelation(step).length > 0
      ? getStepNetworkCorrelation(step)
      : getSummaryNetworkCorrelationForStep(replay, step);
    if (networkCorrelation.length === 0) return false;
  }

  return hasMutationalOperationalStep;
}

function buildReplayBlockers(results = {}, replay = {}) {
  const blockers = [];
  const deterministicOperationalProof = replayHasDeterministicOperationalProof(replay);

  if (results.completeness && !results.completeness.valid) {
    blockers.push(...results.completeness.blockers);
  }
  if (!results.moduleAccess?.isRealAccess) {
    blockers.push({ reason: 'replay_not_operational', details: results.moduleAccess });
  }
  if (!results.journeyPath?.isRealJourney) {
    blockers.push({ reason: 'replay_not_operational', details: results.journeyPath });
  }
  if (!deterministicOperationalProof && !results.realOperation?.isRealOperation) {
    blockers.push({ reason: 'replay_missing_state_transition', details: results.realOperation });
  }
  if (!results.screenshots?.valid) {
    blockers.push({ reason: 'missing_operational_screenshots', details: results.screenshots });
  }
  if (!deterministicOperationalProof && !results.stateAware?.valid) {
    const stateBlockers = Array.isArray(results.stateAware?.blockers) ? results.stateAware.blockers : [];
    const hasMissingMutation = stateBlockers.some((item) => item.reason === 'missing_real_state_mutation');
    blockers.push({
      reason: hasMissingMutation ? 'missing_real_state_mutation' : 'replay_missing_state_transition',
      details: results.stateAware,
    });
  }
  if (!deterministicOperationalProof && results.stateAware?.clickWithoutConsequence === true) {
    blockers.push({ reason: 'validation_only_by_click' });
  }

  return blockers;
}

/**
 * Executa validação operacional completa do replay.
 *
 * PRECONDIÇÃO: Para jornadas blocking (support_ticket_flow, fitness_customer_checkin),
 * afterSnapshot DEVE existir antes de chamar esta função.
 * Se chamado antes de collectAfterSnapshot(), retorna preconditionFailed=true
 * sem nenhum blocker — evita falsos NO_GO temporários.
 */
function validateOperationalReplay(replay = {}, options = {}) {
  const journeyIdNorm = normalizeJourneyId(replay.journeyId || '');
  const isBlockingReplay = ['support_ticket_flow', 'fitness_customer_checkin'].includes(journeyIdNorm);

  // Guard temporal: jornadas blocking exigem afterSnapshot antes de validar.
  // Se afterSnapshot ainda não foi coletado, retornar sem blockers (precondição não atendida).
  if (isBlockingReplay && replay.afterSnapshot == null) {
    return {
      isOperational: false,
      classification: 'precondition_not_met',
      score: 0,
      maxScore: 130,
      percentage: 0,
      replay: {},
      results: {},
      blockers: [],
      preconditionFailed: true,
      preconditionReason: 'after_snapshot_not_yet_collected',
      operationalTimeline: [],
      recommendation: 'validateOperationalReplay chamado antes de afterSnapshot existir — aguardar collectAfterSnapshot()',
    };
  }

  const normalizedReplay = replayNormalizationService.normalizeReplay(replay);
  const replayIntegrity = replay.replayHash || replay.replayChecksum || replay.governanceSignature
    ? validateReplayIntegrity(replay, replay.governance || replay.governanceResult || {})
    : { valid: true, blockers: [] };
  const missingReplay = !normalizedReplay.replayId
    && normalizedReplay.events.length === 0
    && normalizedReplay.screenshots.length === 0;

  if (missingReplay) {
    return {
      isOperational: false,
      classification: 'missing_replay',
      score: 0,
      maxScore: 130,
      percentage: 0,
      replay: normalizedReplay,
      results: {},
      blockers: [{ reason: 'missing_operational_replay' }],
      operationalTimeline: [],
      recommendation: 'Replay operacional obrigatório ausente',
    };
  }

  const results = {
    completeness: validateReplayCompleteness(normalizedReplay),
    moduleAccess: validateRealModuleAccess(normalizedReplay),
    journeyPath: validateRealJourneyPath(normalizedReplay),
    humanBehavior: validateHumanBehavior(normalizedReplay),
    realOperation: validateRealOperation(normalizedReplay),
    screenshots: validateScreenshots(normalizedReplay),
    stateAware: validateStateAwareReplay(normalizedReplay, options),
    replayIntegrity,
  };
  const deterministicOperationalProof = replayHasDeterministicOperationalProof(normalizedReplay);
  if (deterministicOperationalProof) {
    results.stateAware = {
      ...results.stateAware,
      valid: true,
      diagnosticOnly: true,
      reason: 'legacy_state_transition_validation_bypassed_by_deterministic_operational_proof',
    };
    results.realOperation = {
      ...results.realOperation,
      isRealOperation: true,
      diagnosticOnly: true,
      reason: 'legacy_real_operation_validation_bypassed_by_deterministic_operational_proof',
    };
  }

  // Calcular score geral
  let score = 0;
  let maxScore = 0;

  // Module access: 20 pts
  if (results.moduleAccess.isRealAccess && results.completeness.valid) score += 20;
  maxScore += 20;

  // Journey: 20 pts
  if (results.journeyPath.isRealJourney && results.completeness.valid) score += 20;
  maxScore += 20;

  // Behavior: 15 pts
  if (results.humanBehavior.isHumanBehavior) score += 15;
  maxScore += 15;

  // Operation: 25 pts
  if (results.realOperation.isRealOperation) score += 25;
  maxScore += 25;

  // Screenshots: 20 pts
  if (results.screenshots.valid) score += 20;
  maxScore += 20;

  // State transitions + consequence: 30 pts
  if (results.stateAware.valid) score += 30;
  maxScore += 30;

  const percentage = (score / maxScore) * 100;
  const blockers = buildReplayBlockers(results, normalizedReplay);
  if (!replayIntegrity.valid) {
    blockers.push(...replayIntegrity.blockers);
  }
  const diagnosticOnlyReview =
    results.completeness?.hasDiagnosticEvidence === true
    && results.completeness?.hasOperationalEvidence !== true;
  const isOperational = percentage >= 60 && results.completeness.valid && results.stateAware.valid && blockers.length === 0;
  const goNoGo = isOperational ? 'GO' : (diagnosticOnlyReview ? 'REVIEW' : 'NO_GO');

  // Classificar
  let classification = 'not_operational';
  if (percentage >= 80) classification = 'fully_operational';
  else if (percentage >= 60) classification = 'mostly_operational';
  else if (percentage >= 40) classification = 'partially_operational';
  else if (percentage >= 20) classification = 'minimal_operational';

  return {
    isOperational,
    goNoGo,
    classification,
    score: Math.round(score),
    maxScore,
    percentage: Math.round(percentage),
    replay: normalizedReplay,
    results,
    blockers,
    operationalTimeline: results.stateAware.timeline,
    recommendation:
      isOperational
        ? 'Replay é operacionalmente válido'
        : diagnosticOnlyReview
          ? 'Replay contém apenas evidência diagnóstica; requer prova operacional para GO'
        : 'Replay não atende critérios operacionais mínimos de transição de estado e consequência operacional',
  };
}

function validateOperationalConsequences(replay = {}, expectedConsequences = []) {
  const normalizedReplay = replayNormalizationService.normalizeReplay(replay);
  const observed = new Set(inferObservedSideEffects(normalizedReplay));

  const required = Array.isArray(expectedConsequences) ? expectedConsequences : [];
  const missing = required.filter((item) => !observed.has(String(item)));

  return {
    valid: missing.length === 0,
    expected: required,
    observed: Array.from(observed),
    missing,
  };
}

/**
 * Gera sugestões de melhoria para replay
 */
function suggestReplayImprovements(validationResult = {}) {
  const suggestions = [];
  const { results } = validationResult;

  if (!results.moduleAccess.isRealAccess) {
    suggestions.push({
      type: 'module_access',
      severity: 'critical',
      action: 'Adicionar logs de acesso a módulos reais (não stubs)',
    });
  }

  if (!results.journeyPath.isRealJourney) {
    suggestions.push({
      type: 'journey_depth',
      severity: 'critical',
      action: 'Expandir replay para percorrer mais páginas/módulos reais',
    });
  }

  if (!results.humanBehavior.isHumanBehavior) {
    suggestions.push({
      type: 'behavior_pattern',
      severity: 'high',
      action: `Adicionar hesitações/delays/retries: ${results.humanBehavior.issues.join(', ')}`,
    });
  }

  if (!results.realOperation.isRealOperation) {
    suggestions.push({
      type: 'operation_consequences',
      severity: 'critical',
      action: 'Operação deve produzir consequências observáveis (DB writes, events, API calls)',
    });
  }

  if (!results.screenshots.valid) {
    suggestions.push({
      type: 'screenshots',
      severity: 'high',
      action: `Adicionar screenshots críticos: ${results.screenshots.issues.join(', ')}`,
    });
  }

  return suggestions;
}

module.exports = {
  validateOperationalReplay,
  validateReplayCompleteness,
  validateReplayStepEvidence,
  validateOperationalSeedLinkage,
  validateRealModuleAccess,
  validateRealJourneyPath,
  validateHumanBehavior,
  validateRealOperation,
  validateScreenshots,
  validateStateAwareReplay,
  validateOperationalConsequences,
  suggestReplayImprovements,
  replayHasDeterministicOperationalProof,
  __testOnly__inferObservedSideEffects: inferObservedSideEffects,
};
