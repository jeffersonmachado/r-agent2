'use strict';

const fs = require('fs');
const path = require('path');
const stateSnapshotService = require('./stateSnapshotService');
const transitionInferenceService = require('./transitionInferenceService');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const STATE_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'operational-state-registry.json');
const TRANSITION_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'operational-transition-contracts.json');

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function loadStateRegistry(overrideRegistry = null) {
  if (overrideRegistry && typeof overrideRegistry === 'object') {
    return overrideRegistry;
  }
  return readJsonSafe(STATE_REGISTRY_PATH, {});
}

function loadTransitionContracts(overrideContracts = null) {
  if (overrideContracts && typeof overrideContracts === 'object') {
    return overrideContracts;
  }
  return readJsonSafe(TRANSITION_CONTRACTS_PATH, {});
}

function buildStateMachine(journeyId, registry = {}) {
  const machine = registry[journeyId] || { states: [] };
  const states = Array.isArray(machine.states) ? machine.states.map((state) => String(state)) : [];
  return {
    journeyId,
    states,
    knownStates: new Set(states),
  };
}

function getJourneyMandatoryRules(journeyId = '') {
  const normalized = String(journeyId || '').toLowerCase();
  if (normalized === 'support_ticket_flow') {
    return {
      minMutationCount: 1,
      requiredMutationPaths: ['db.ticket.status', 'db.ticket.messages.count'],
      requiredSideEffects: ['crm_updated', 'audit_log_created'],
    };
  }
  if (normalized === 'fitness_customer_checkin') {
    return {
      minMutationCount: 1,
      requiredMutationPaths: ['db.attendance', 'api.access.decision', 'devices.access.events'],
      requiredSideEffects: ['attendance_recorded', 'access_decision_allow', 'crm_presence_updated'],
    };
  }
  if (normalized === 'booking_flow') {
    return {
      minMutationCount: 1,
      requiredMutationPaths: ['db.booking.count'],
      requiredSideEffects: ['booking_created', 'crm_updated'],
    };
  }
  return {
    minMutationCount: 1,
    requiredMutationPaths: [],
    requiredSideEffects: [],
  };
}

function evaluateTransition(options = {}) {
  const registry = loadStateRegistry(options.stateRegistry);
  const contracts = loadTransitionContracts(options.transitionContracts);

  const inferred = options.transitionId
    ? { transitionId: options.transitionId, contract: contracts[options.transitionId] || null }
    : transitionInferenceService.inferTransitionFromStep(
      {
        dataTestId: options.dataTestId,
        selector: options.selector,
        action: options.action,
        type: options.action,
        journeyId: options.journeyId,
      },
      { contracts }
    );

  const transitionId = options.transitionId || inferred.transitionId;
  const contract = transitionId ? contracts[transitionId] || {} : inferred.contract || {};
  const journeyId = options.journeyId || contract.journeyId || inferred.journeyId || null;
  const machine = buildStateMachine(journeyId, registry);

  const snapshots = stateSnapshotService.captureTransitionSnapshots({
    before: options.beforeSnapshot,
    after: options.afterSnapshot,
  });

  const initialState = options.initialState
    || contract.initialState
    || stateSnapshotService.inferStateFromSnapshot(snapshots.before, null);
  const transitionState = options.transitionState
    || contract.expectedTransition
    || stateSnapshotService.inferStateFromSnapshot(snapshots.after, null);
  const finalState = options.finalState
    || contract.finalState
    || stateSnapshotService.inferStateFromSnapshot(snapshots.after, null);

  const observedSideEffects = Array.from(new Set([
    ...(Array.isArray(options.observedSideEffects) ? options.observedSideEffects.map(String) : []),
    ...(Array.isArray(snapshots.observedSideEffects) ? snapshots.observedSideEffects.map(String) : []),
  ]));
  const requiredSideEffects = Array.isArray(options.requiredSideEffects)
    ? options.requiredSideEffects
    : (Array.isArray(contract.requiredSideEffects) ? contract.requiredSideEffects : []);
  const journeyRules = getJourneyMandatoryRules(journeyId);
  const mergedRequiredSideEffects = Array.from(new Set([
    ...requiredSideEffects.map(String),
    ...journeyRules.requiredSideEffects.map(String),
  ]));

  const missingSideEffects = mergedRequiredSideEffects.filter((item) => !observedSideEffects.includes(String(item)));

  const invalidStates = [];
  if (initialState && !machine.knownStates.has(initialState)) invalidStates.push(initialState);
  if (transitionState && !machine.knownStates.has(transitionState)) invalidStates.push(transitionState);
  if (finalState && !machine.knownStates.has(finalState)) invalidStates.push(finalState);

  const stateChanged = Boolean(initialState && transitionState && initialState !== transitionState);
  const realMutationObserved = Number(snapshots.mutationCount || 0) >= Number(journeyRules.minMutationCount || 1);
  const mutationPaths = snapshots.sideEffects
    .flatMap((source) => (source.mutations || []).map((mutation) => `${source.source}.${mutation.path}`));
  const missingMutationProofPaths = journeyRules.requiredMutationPaths.filter((requiredPath) => {
    const required = String(requiredPath || '').toLowerCase();
    return !mutationPaths.some((pathName) => String(pathName).toLowerCase().includes(required));
  });
  const snapshotContract = stateSnapshotService.validateSnapshotContracts({
    journeyId,
    beforeSnapshot: snapshots.before,
    afterSnapshot: snapshots.after,
    contracts: options.snapshotContracts,
  });
  const beforeEvidence = stateSnapshotService.validateSnapshotEvidence({
    journeyId,
    phase: 'before',
    snapshot: snapshots.before,
    contracts: options.snapshotContracts,
  });
  const afterEvidence = stateSnapshotService.validateSnapshotEvidence({
    journeyId,
    phase: 'after',
    snapshot: snapshots.after,
    contracts: options.snapshotContracts,
  });
  const finalReached = Boolean(transitionState && finalState && transitionState === finalState)
    || Boolean(finalState && snapshots.after?.state === finalState)
    || Boolean(finalState && stateSnapshotService.inferStateFromSnapshot(snapshots.after) === finalState);

  const valid = Boolean(stateChanged)
    && realMutationObserved
    && beforeEvidence.valid
    && afterEvidence.valid
    && snapshotContract.valid
    && invalidStates.length === 0
    && missingSideEffects.length === 0
    && missingMutationProofPaths.length === 0
    && (finalReached || !finalState);

  const blockers = [];
  if (!stateChanged) blockers.push({ reason: 'state_not_changed', initialState, transitionState });
  if (!realMutationObserved) blockers.push({ reason: 'missing_real_state_mutation' });
  if (!beforeEvidence.valid) blockers.push({ reason: 'snapshot_before_invalid', details: beforeEvidence.blockers });
  if (!afterEvidence.valid) blockers.push({ reason: 'snapshot_after_invalid', details: afterEvidence.blockers });
  if (!snapshotContract.valid) blockers.push({ reason: 'snapshot_contract_failed', missing: snapshotContract.missing });
  if (invalidStates.length > 0) blockers.push({ reason: 'invalid_states_detected', states: invalidStates });
  if (missingSideEffects.length > 0) blockers.push({ reason: 'missing_side_effects', missing: missingSideEffects });
  if (missingMutationProofPaths.length > 0) blockers.push({ reason: 'mandatory_mutation_missing', missing: missingMutationProofPaths });
  if (!finalReached && finalState) blockers.push({ reason: 'final_state_not_reached', expected: finalState, observed: transitionState });

  return {
    valid,
    journeyId,
    transitionId,
    action: options.action || contract.action || inferred.action || null,
    initialState,
    transitionState,
    finalState,
    requiredSideEffects: mergedRequiredSideEffects,
    observedSideEffects,
    missingSideEffects,
    missingMutationProofPaths,
    invalidStates,
    stateChanged,
    finalReached,
    snapshots,
    snapshotEvidence: {
      before: beforeEvidence,
      after: afterEvidence,
    },
    snapshotContract,
    realMutationObserved,
    blockers,
    timeline: {
      before: initialState,
      action: options.action || contract.action || inferred.action || null,
      transition: transitionState,
      after: finalState,
      sideEffects: observedSideEffects,
      technicalEvidence: {
        mutationCount: snapshots.mutationCount,
        snapshotContract: snapshotContract.valid ? 'passed' : 'failed',
        snapshotEvidence: beforeEvidence.valid && afterEvidence.valid ? 'passed' : 'failed',
      },
    },
    remediation: buildTransitionRemediation(blockers),
  };
}

function buildTransitionRemediation(blockers = []) {
  const remediation = [];

  for (const blocker of blockers) {
    if (blocker.reason === 'state_not_changed') {
      remediation.push('Implementar mutacao real de estado em DB/API/UI/replay/evento.');
    }
    if (blocker.reason === 'missing_real_state_mutation') {
      remediation.push('Coletar snapshots antes/depois e comprovar diferenca real em DB/API/UI/replay/eventos.');
    }
    if (blocker.reason === 'mandatory_mutation_missing') {
      remediation.push('Comprovar mutacoes obrigatorias da jornada com diff de snapshot e evidencias operacionais por entidade.');
    }
    if (blocker.reason === 'snapshot_contract_failed') {
      remediation.push('Cumprir contrato de snapshot da jornada antes de aprovar GO operacional.');
    }
    if (blocker.reason === 'snapshot_before_invalid' || blocker.reason === 'snapshot_after_invalid') {
      remediation.push('Coletar snapshot real com fonte obrigatoria disponivel; diferenciar fonte indisponivel de dado inexistente.');
    }
    if (blocker.reason === 'missing_side_effects') {
      remediation.push('Adicionar validadores de side effects obrigatorios e garantir emissao operacional.');
    }
    if (blocker.reason === 'invalid_states_detected') {
      remediation.push('Alinhar estados da jornada com o registry operacional e corrigir transicoes.');
    }
    if (blocker.reason === 'final_state_not_reached') {
      remediation.push('Completar cadeia operacional ate o estado final esperado.');
    }
  }

  return remediation;
}

function validateExecutionChainState(options = {}) {
  const transitions = Array.isArray(options.transitions) ? options.transitions : [];
  const validations = transitions.map((transition) => evaluateTransition({
    ...transition,
    stateRegistry: options.stateRegistry,
    transitionContracts: options.transitionContracts,
  }));

  const failed = validations.filter((item) => !item.valid);
  const reachedStates = validations
    .map((item) => [item.initialState, item.transitionState, item.finalState])
    .flat()
    .filter(Boolean);

  const transitionCoverage = validations.length === 0
    ? 0
    : Math.round(((validations.length - failed.length) / validations.length) * 100);

  const sideEffectCoverage = validations.length === 0
    ? 0
    : Math.round((validations.filter((item) => item.missingSideEffects.length === 0).length / validations.length) * 100);

  const stateValidationCoverage = validations.length === 0
    ? 0
    : Math.round((validations.filter((item) => (
      item.invalidStates.length === 0
      && item.stateChanged
      && item.realMutationObserved
      && item.snapshotEvidence?.before?.valid
      && item.snapshotEvidence?.after?.valid
      && item.snapshotContract?.valid
    )).length / validations.length) * 100);

  const operationalConsequenceCoverage = Math.round(
    Math.max(0, Math.min(100, (transitionCoverage * 0.2) + (stateValidationCoverage * 0.3) + (sideEffectCoverage * 0.5)))
  );

  return {
    valid: failed.length === 0 && operationalConsequenceCoverage > 0,
    validations,
    failedTransitions: failed.map((item) => ({
      transitionId: item.transitionId,
      action: item.action,
      blockers: item.blockers,
    })),
    reachedStates: Array.from(new Set(reachedStates)),
    coverage: {
      transitionCoverage,
      stateValidationCoverage,
      sideEffectCoverage,
      operationalConsequenceCoverage,
    },
    remediation: failed.flatMap((item) => item.remediation),
  };
}

function evaluateOperationalStateFlow(options = {}) {
  const transitions = Array.isArray(options.transitions) ? options.transitions : [];
  const chain = validateExecutionChainState({
    ...options,
    transitions,
  });

  const blockers = [];
  if (chain.coverage.transitionCoverage === 0) blockers.push({ reason: 'transition_never_validated' });
  if (chain.coverage.stateValidationCoverage === 0) blockers.push({ reason: 'state_change_not_validated' });
  if (chain.coverage.sideEffectCoverage === 0) blockers.push({ reason: 'side_effect_not_validated' });
  if (chain.coverage.operationalConsequenceCoverage === 0) blockers.push({ reason: 'operational_consequence_not_validated' });
  if (chain.validations.some((item) => !item.realMutationObserved)) blockers.push({ reason: 'missing_real_state_mutation' });
  if (chain.validations.some((item) => !item.snapshotEvidence?.before?.valid || !item.snapshotEvidence?.after?.valid)) {
    blockers.push({ reason: 'snapshot_evidence_invalid' });
  }
  if (chain.validations.some((item) => item.snapshotContract && !item.snapshotContract.valid)) blockers.push({ reason: 'snapshot_contract_failed' });
  blockers.push(...chain.failedTransitions.map((item) => ({ reason: 'transition_failed', transition: item })));

  return {
    goNoGo: blockers.length === 0 ? 'GO' : 'NO_GO',
    blockers,
    chain,
    timeline: chain.validations.map((item) => item.timeline),
    remediation: Array.from(new Set(chain.remediation)),
  };
}

module.exports = {
  loadStateRegistry,
  loadTransitionContracts,
  buildStateMachine,
  evaluateTransition,
  validateExecutionChainState,
  evaluateOperationalStateFlow,
};
