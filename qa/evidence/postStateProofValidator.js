'use strict';

/**
 * postStateProofValidator.js
 *
 * POST-STATE proof: executado APÓS collectAfterSnapshot().
 *
 * Valida o que só é possível provar depois de ter o afterSnapshot real:
 *   - snapshot diff real (before !== after)
 *   - observedMutations canônicas derivadas do diff incremental por paths exatos
 *   - observedSideEffects canônicos derivados do diff incremental por paths exatos
 *   - mutationCount > 0
 *   - estado final comprovado
 *
 * Pipeline operacional obrigatório:
 *   1. collectStepBeforeSnapshot()
 *   2. executeStep()
 *   3. validateStepExecutionProof()
 *   4. collectStepAfterSnapshot()
 *   5. computeIncrementalStepDiff()
 *   6. deriveObservedMutations() / deriveObservedSideEffects()
 *   7. buildMutationLinkage()
 *   8. validatePostStateProof()
 *   9. appendProofChainToReplay()
 */

const { computeRealSnapshotDiff } = require('./evidenceProofValidator');
const {
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  getEntityScopeForStep,
  isMutationExpectedStep: registryIsMutationExpectedStep,
  getStepSpec,
  matchExpectedNetworkEvent,
} = require('../contracts/operationalStepRegistry');

// ---------------------------------------------------------------------------
// Canonical derivation rules: exact diff path + exact operator → canonical id
// ---------------------------------------------------------------------------

const CANONICAL_MUTATION_RULES = [
  { stepId: 'step_reply_ticket', path: 'db.messages.count', op: 'incremented', mutation: 'message_created' },
  { stepId: 'step_reply_ticket', path: 'events.messages.count', op: 'incremented', mutation: 'message_created' },
  { stepId: 'step_takeover_ticket', path: 'db.ticket.status', op: 'changed', mutation: 'ticket_status_changed' },
  { stepId: 'step_takeover_ticket', path: 'db.ticketStatus', op: 'changed', mutation: 'ticket_status_changed' },
  { stepId: 'step_change_status', path: 'db.ticket.status', op: 'changed', mutation: 'ticket_status_changed' },
  { stepId: 'step_change_status', path: 'db.ticketStatus', op: 'changed', mutation: 'ticket_status_changed' },
  { stepId: 'step_submit_checkin', path: 'db.attendance.count', op: 'incremented', mutation: 'attendance_created' },
  { stepId: 'step_submit_checkin', path: 'db.attendance.created', op: 'became_true', mutation: 'attendance_created' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.count', op: 'incremented', mutation: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.exists', op: 'became_true', mutation: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.id', op: 'appeared', mutation: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'api.booking.id', op: 'appeared', mutation: 'booking_created' },
  { stepId: 'step_create_membership_charge', path: 'db.billing.count', op: 'incremented', mutation: 'payment_created' },
  { stepId: 'step_create_membership_charge', path: 'db.billing.exists', op: 'became_true', mutation: 'payment_created' },
  { stepId: 'step_create_membership_charge', path: 'db.billing.id', op: 'appeared', mutation: 'payment_created' },
  { stepId: 'step_create_membership_charge', path: 'api.billing.transactionId', op: 'appeared', mutation: 'payment_created' },
  { stepId: 'step_confirm_membership_payment', path: 'db.billing.status', op: 'changed', mutation: 'payment_status_changed' },
  { stepId: 'step_update_order_status', path: 'db.order.status', op: 'changed', mutation: 'order_status_changed' },
  { stepId: 'step_publish_marketplace_node', path: 'db.nodeMarketplace.published.exists', op: 'became_true', mutation: 'node_published' },
  { stepId: 'step_publish_marketplace_node', path: 'db.nodeMarketplace.published.id', op: 'appeared', mutation: 'node_published' },
  { stepId: 'step_create_calendar_block', path: 'db.calendar.block.exists', op: 'became_true', mutation: 'calendar_block_created' },
  { stepId: 'step_create_calendar_block', path: 'db.calendar.block.id', op: 'appeared', mutation: 'calendar_block_created' },
];

const CANONICAL_SIDE_EFFECT_RULES = [
  { stepId: 'step_takeover_ticket', path: 'events.audit.count', op: 'incremented', sideEffect: 'audit_log_created' },
  { stepId: 'step_reply_ticket', path: 'events.audit.count', op: 'incremented', sideEffect: 'audit_log_created' },
  { stepId: 'step_reply_ticket', path: 'crm.activities.count', op: 'incremented', sideEffect: 'crm_updated' },
  { stepId: 'step_reply_ticket', path: 'events.notifications.count', op: 'incremented', sideEffect: 'notification_sent' },
  { stepId: 'step_reply_ticket', path: 'events.notifications.sent', op: 'incremented', sideEffect: 'notification_sent' },
  { stepId: 'step_change_status', path: 'events.audit.count', op: 'incremented', sideEffect: 'audit_log_created' },
  { stepId: 'step_submit_checkin', path: 'api.access.decision.count', op: 'incremented', sideEffect: 'access_decision_created' },
  { stepId: 'step_submit_checkin', path: 'api.access.decision.allow', op: 'became_true', sideEffect: 'access_decision_created' },
  { stepId: 'step_submit_checkin', path: 'devices.access.events', op: 'incremented', sideEffect: 'access_event_created' },
  { stepId: 'step_submit_checkin', path: 'events.access.count', op: 'incremented', sideEffect: 'access_event_created' },
  { stepId: 'step_submit_checkin', path: 'crm.presenceActivity.count', op: 'incremented', sideEffect: 'crm_journey_updated' },
  { stepId: 'step_submit_checkin', path: 'crm.presenceActivity.created', op: 'became_true', sideEffect: 'crm_journey_updated' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.count', op: 'incremented', sideEffect: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.exists', op: 'became_true', sideEffect: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'db.booking.id', op: 'appeared', sideEffect: 'booking_created' },
  { stepId: 'step_create_resource_booking', path: 'api.booking.id', op: 'appeared', sideEffect: 'booking_created' },
  { stepId: 'step_create_membership_charge', path: 'events.notifications.count', op: 'incremented', sideEffect: 'notification_sent' },
  { stepId: 'step_create_membership_charge', path: 'events.notifications.sent', op: 'incremented', sideEffect: 'notification_sent' },
  { stepId: 'step_update_order_status', path: 'events.order_status.count', op: 'incremented', sideEffect: 'event_ledger_recorded' },
  { stepId: 'step_publish_marketplace_node', path: 'db.nodeMarketplace.catalog.count', op: 'incremented', sideEffect: 'catalog_updated' },
  { stepId: 'step_publish_marketplace_node', path: 'api.nodeMarketplace.catalog.count', op: 'incremented', sideEffect: 'catalog_updated' },
  { stepId: 'step_create_calendar_block', path: 'db.calendar.block.count', op: 'incremented', sideEffect: 'calendar_updated' },
  { stepId: 'step_create_calendar_block', path: 'api.calendar.resource.blockCount', op: 'incremented', sideEffect: 'calendar_updated' },
];

function getStepId(step = {}) {
  return typeof step === 'string' ? step : (step?.id || step?.stepId || null);
}

function detailMatchesRule(detail = {}, rule = {}, stepId = null) {
  if (stepId && rule.stepId !== stepId) return false;
  if (String(detail.field || '') !== String(rule.path || '')) return false;
  if (rule.op === 'changed') return detail.before !== detail.after;
  if (rule.op === 'incremented') return Number(detail.after) > Number(detail.before);
  if (rule.op === 'became_true') return detail.before !== true && detail.after === true;
  if (rule.op === 'appeared') {
    return (detail.before === null || detail.before === undefined || detail.before === '')
      && !(detail.after === null || detail.after === undefined || detail.after === '');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mutation derivation engine
// ---------------------------------------------------------------------------

/**
 * Deriva mutações OBSERVADAS a partir do diff incremental do step.
 * Somente regras canônicas por stepId + path exato são aceitas.
 *
 * @param {object} diff - resultado de computeRealSnapshotDiff()
 * @returns {string[]} observedMutations
 */
function deriveObservedMutations(diff = {}, step = {}) {
  if (!diff || !diff.changed || !Array.isArray(diff.details) || diff.details.length === 0) {
    return [];
  }

  const stepId = getStepId(step);
  const mutations = new Set();

  for (const detail of diff.details) {
    for (const rule of CANONICAL_MUTATION_RULES) {
      if (detailMatchesRule(detail, rule, stepId)) {
        mutations.add(rule.mutation);
      }
    }
  }

  return Array.from(mutations);
}

/**
 * Deriva side effects OBSERVADOS a partir do diff incremental do step.
 * Somente regras canônicas por stepId + path exato são aceitas.
 *
 * @param {object} diff - resultado de computeRealSnapshotDiff()
 * @returns {string[]} observedSideEffects
 */
function deriveObservedSideEffects(diff = {}, step = {}) {
  if (!diff || !diff.changed || !Array.isArray(diff.details) || diff.details.length === 0) {
    return [];
  }

  const stepId = getStepId(step);
  const sideEffects = new Set();

  for (const detail of diff.details) {
    for (const rule of CANONICAL_SIDE_EFFECT_RULES) {
      if (detailMatchesRule(detail, rule, stepId)) {
        sideEffects.add(rule.sideEffect);
      }
    }
  }

  return Array.from(sideEffects);
}

// ---------------------------------------------------------------------------
// Mutation provenance tracking
// ---------------------------------------------------------------------------

/**
 * Estrutura de provenance para uma mutação:
 * {
 *   mutation: string (nome da mutação observada)
 *   originatingStepId: string (qual step a causou)
 *   originatingNetworkEvents: [{method, url, status}] (evento esperado exato)
 *   beforeSnapshotHash: string (hash do snapshot antes, primeiros 8 chars)
 *   afterSnapshotHash: string (hash do snapshot depois, primeiros 8 chars)
 *   correlatedBy: 'network_linkage' | 'expected_network_event_not_found' (tipo de prova)
 *   valid: boolean
 *   reason: string|null
 * }
 */

/**
 * Computa provenance determinística de cada mutação observada.
 * Rastreia qual step + expectedNetworkEvent exato causou cada mutação.
 *
 * @param {object} step - step que possivelmente causou a mutação
 * @param {string[]} observedMutations - mutações derivadas do diff do step
 * @param {object|null} beforeStepSnapshot
 * @param {object|null} afterStepSnapshot
 * @returns {object[]} array de provenance records
 */
function computeMutationProvenance({
  step = {},
  observedMutations = [],
  beforeStepSnapshot = null,
  afterStepSnapshot = null,
} = {}) {
  if (!Array.isArray(observedMutations) || observedMutations.length === 0) {
    return [];
  }

  const crypto = require('crypto');
  const stepId = step.id || step.stepId || 'unknown';
  const contract = getStepSpec(stepId);
  const actionType = contract?.actionType || step.actionType || step.action || step.type || 'unknown';
  const entityScope = getEntityScopeForStep(stepId);
  const allNetworkEvents = Array.isArray(step.networkEvents) ? step.networkEvents : [];

  // CAUSALIDADE: usar matchExpectedNetworkEvent do contrato, não primeiro 2xx
  const contractMatchedEvent = matchExpectedNetworkEvent(stepId, allNetworkEvents);
  // Compute hashes for snapshot identification
  const beforeHash = beforeStepSnapshot
    ? crypto
        .createHash('sha256')
        .update(JSON.stringify(beforeStepSnapshot))
        .digest('hex')
        .substring(0, 8)
    : null;
  const afterHash = afterStepSnapshot
    ? crypto
        .createHash('sha256')
        .update(JSON.stringify(afterStepSnapshot))
        .digest('hex')
        .substring(0, 8)
    : null;

  // Correlate each mutation with network events
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
      entityScope,
      beforeStepSnapshotHash: beforeHash,
      afterStepSnapshotHash: afterHash,
      beforeSnapshotHash: beforeHash,
      afterSnapshotHash: afterHash,
      correlatedBy: hasMatchedNetworkEvent ? 'network_linkage' : 'expected_network_event_not_found',
      valid: hasMatchedNetworkEvent,
      reason: hasMatchedNetworkEvent ? null : 'expected_network_event_not_found',
    };
  });
}

/**
 * Verifica se step DEVE gerar mutações.
 * BASEADO EXCLUSIVAMENTE no registry, nunca em heurística.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {boolean}
 */
function isMutationExpectedStep(stepIdOrSpec) {
  return registryIsMutationExpectedStep(stepIdOrSpec);
}

/**
 * Computa diff incremental por step usando snapshots before/after do próprio step.
 *
 * Retorna sempre estrutura canônica para facilitar validação causal.
 */
function computeIncrementalStepDiff({
  step = {},
  beforeStepSnapshot = null,
  afterStepSnapshot = null,
} = {}) {
  const stepId = step.id || step.stepId || 'unknown';
  const actionType = step.actionType || step.action || step.type || 'unknown';
  const hasSnapshots = beforeStepSnapshot != null && afterStepSnapshot != null;

  if (!hasSnapshots) {
    return {
      stepId,
      actionType,
      changed: false,
      hasSnapshots: false,
      diff: null,
      observedMutations: [],
      observedSideEffects: [],
      mutationCount: 0,
    };
  }

  const diff = computeRealSnapshotDiff(beforeStepSnapshot, afterStepSnapshot);
  const observedMutations = deriveObservedMutations(diff, { ...step, id: stepId, actionType });
  const observedSideEffects = deriveObservedSideEffects(diff, { ...step, id: stepId, actionType });

  return {
    stepId,
    actionType,
    changed: Boolean(diff?.changed),
    hasSnapshots: true,
    diff,
    observedMutations,
    observedSideEffects,
    mutationCount: observedMutations.length,
  };
}

// ---------------------------------------------------------------------------
// validatePostStateProof
// ---------------------------------------------------------------------------

/**
 * Valida o estado pós-execução: diff incremental real, mutações observadas,
 * side effects observados, provenance determinística e estado final.
 *
 * DEVE ser chamado somente após:
 *   - afterStepSnapshot coletado
 *   - diff incremental computado via computeIncrementalStepDiff()
 *
 * @param {object} params
 * @param {object|null} params.beforeSnapshot - snapshot coletado antes do step
 * @param {object|null} params.afterSnapshot  - snapshot coletado APÓS o step
 * @param {object} params.step                - step enriquecido
 * @param {object} params.journeyContext      - { isBlockingJourney, executionMode, journeyId }
 * @returns {PostStateProofResult}
 */
function validatePostStateProof({
  beforeSnapshot = null,
  afterSnapshot = null,
  step = {},
  incrementalDiff = null,
  journeyContext = {},
} = {}) {
  const stepId = step.id || step.stepId || 'unknown';
  const actionType = step.actionType || 'unknown';
  const blocking = Boolean(journeyContext.isBlockingJourney);
  const executionMode = String(journeyContext.executionMode || 'operational_go').toLowerCase();

  const requiresPostState = isMutationExpectedStep(step);

  const blockers = [];

  // ── 0. Guard: afterSnapshot deve existir ─────────────────────────────────
  if (afterSnapshot == null) {
    blockers.push({
      reason: 'post_state_proof_missing_after_snapshot',
      stepId,
      actionType,
      message: 'validatePostStateProof chamado antes de collectAfterSnapshot()',
    });

    return {
      phase: 'post_state',
      valid: false,
      stepId,
      actionType,
      requiresPostState,
      afterSnapshotPresent: false,
      diff: null,
      observedMutations: [],
      observedSideEffects: [],
      mutationCount: 0,
      blockers,
      goNoGo: blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
    };
  }

  // ── 1. Compute incremental step diff (causalidade por step) ───────────────
  const incremental = incrementalDiff || computeIncrementalStepDiff({
    step,
    beforeStepSnapshot: beforeSnapshot,
    afterStepSnapshot: afterSnapshot,
  });
  const diff = incremental.diff;
  const observedMutations = Array.isArray(incremental.observedMutations)
    ? incremental.observedMutations
    : [];
  const observedSideEffects = Array.isArray(incremental.observedSideEffects)
    ? incremental.observedSideEffects
    : [];
  const mutationCount = Number(incremental.mutationCount || 0);

  if (!requiresPostState) {
    // Passos não-mutacionais: apenas registrar diff sem falhar
    return {
      phase: 'post_state',
      valid: true,
      stepId,
      actionType,
      requiresPostState: false,
      afterSnapshotPresent: true,
      diff,
      observedMutations,
      observedSideEffects,
      mutationCount,
      blockers: [],
      goNoGo: null,
    };
  }

  if (!incremental.hasSnapshots) {
    blockers.push({
      reason: 'post_state_proof_missing_step_snapshots',
      stepId,
      actionType,
      message: 'beforeStepSnapshot/afterStepSnapshot ausentes para step mutacional',
    });
  }

  // ── 3. Snapshot must have changed ────────────────────────────────────────
  if (!incremental.changed) {
    blockers.push({
      reason: 'post_state_proof_snapshot_unchanged',
      stepId,
      actionType,
      message: 'before === after — nenhuma mutação real ocorreu',
      snapshotBefore: beforeSnapshot,
      snapshotAfter: afterSnapshot,
    });
  }

  // ── 4. mutationCount must be > 0 ─────────────────────────────────────────
  if (mutationCount === 0) {
    blockers.push({
      reason: 'post_state_proof_no_observed_mutations',
      stepId,
      actionType,
      message: 'nenhuma mutação observada derivada do diff real',
      diff,
    });
  }

  // ── 5. Validate expected mutations por registry ───────────────────────────
  const expectedMutations = getExpectedMutationsForStep(step);

  const missingMutations = expectedMutations.filter(
    (em) => !observedMutations.some((om) => String(om) === String(em)),
  );

  if (missingMutations.length > 0) {
    blockers.push({
      reason: 'post_state_proof_expected_mutations_not_observed',
      stepId,
      actionType,
      expectedMutations,
      observedMutations,
      missingMutations,
    });
  }

  // ── 6. Validate expected side effects por registry ────────────────────────
  const expectedSideEffects = getExpectedSideEffectsForStep(step);

  const missingSideEffects = expectedSideEffects.filter(
    (es) => !observedSideEffects.some(
      (os) => os === es,
    ),
  );

  if (missingSideEffects.length > 0) {
    blockers.push({
      reason: 'post_state_proof_expected_side_effects_not_observed',
      stepId,
      actionType,
      expectedSideEffects,
      observedSideEffects,
      missingSideEffects,
    });
  }

  const valid = blockers.length === 0;
  let goNoGo = null;
  if (!valid && blocking) {
    goNoGo = executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO';
  }

  return {
    phase: 'post_state',
    valid,
    stepId,
    actionType,
    requiresPostState,
    afterSnapshotPresent: true,
    diff,
    observedMutations,
    observedSideEffects,
    mutationCount,
    expectedMutations,
    expectedSideEffects,
    missingMutations: missingMutations.length > 0 ? missingMutations : undefined,
    missingSideEffects: missingSideEffects.length > 0 ? missingSideEffects : undefined,
    blockers,
    goNoGo,
  };
}

// ---------------------------------------------------------------------------
// appendProofChainToReplay
// ---------------------------------------------------------------------------

/**
 * Agrega os resultados de step-execution proof e post-state proof em um
 * proofChain completo, e retorna o step enriquecido com todos os campos.
 *
 * @param {object} enrichedStep - step após executeStep()
 * @param {object} stepExecutionProof - resultado de validateStepExecutionProof()
 * @param {object} postStateProof - resultado de validatePostStateProof()
 * @returns {object} step com proofChain completo
 */
function appendProofChainToReplay(enrichedStep = {}, stepExecutionProof = {}, postStateProof = {}) {
  const proofChain = {
    // Step-time proof
    browserAction: Boolean(enrichedStep.selectorUsed || enrichedStep.screenshotAfter),
    networkProof: stepExecutionProof.networkProof?.valid ?? true,
    screenshotBefore: Boolean(enrichedStep.screenshotBefore),
    screenshotAfter: Boolean(enrichedStep.screenshotAfter),
    domCaptured: Boolean(enrichedStep.domSnapshot || enrichedStep.domAfter),
    urlCaptured: Boolean(enrichedStep.url),

    // Post-state proof
    snapshotDiff: postStateProof.diff?.changed ?? null,
    observedMutations: postStateProof.observedMutations ?? [],
    observedSideEffects: postStateProof.observedSideEffects ?? [],
    mutationCount: postStateProof.mutationCount ?? 0,
    finalStateProof: postStateProof.afterSnapshotPresent ?? false,

    // Overall
    stepExecutionValid: stepExecutionProof.valid ?? true,
    postStateValid: postStateProof.valid ?? true,
    complete:
      (stepExecutionProof.valid ?? true) &&
      (!postStateProof.requiresPostState || (postStateProof.valid ?? true)),
  };

  const allBlockers = [
    ...(stepExecutionProof.blockers || []),
    ...(postStateProof.blockers || []),
  ];

  const goNoGo = stepExecutionProof.goNoGo || postStateProof.goNoGo || null;

  return {
    ...enrichedStep,
    proofChain,
    stepExecutionProof,
    postStateProof,
    snapshotDiff: postStateProof.diff || enrichedStep.snapshotDiff || null,
    observedMutations: postStateProof.observedMutations || [],
    observedSideEffects: postStateProof.observedSideEffects || [],
    mutationProvenance: postStateProof.mutationProvenance || enrichedStep.mutationProvenance || [],
    proofBlockers: allBlockers,
    proofGoNoGo: goNoGo,
  };
}

// ---------------------------------------------------------------------------
// deriveStepScopedMutations
// ---------------------------------------------------------------------------

/**
 * Correlaciona cada step executado com as mutações que ele causou.
 *
 * Usa exclusivamente o diff incremental do próprio step, snapshots entity-scoped
 * e matching exato entre mutations/side effects esperados e observados.
 * Retorna goNoGo='NO_GO' para qualquer step que exige mutação por contrato mas
 * nenhuma mutação canônica exata foi observada no diff incremental.
 *
 * Pipeline esperado:
 *   collectStepBeforeSnapshot() → executeStep() → collectStepAfterSnapshot()
 *   → computeIncrementalStepDiff() → deriveObservedMutations()
 *   → deriveObservedSideEffects() → deriveStepScopedMutations()
 *
 * @param {object[]} steps           - steps executados (com id, actionType, networkEvents)
 * @param {object|null} beforeSnapshot
 * @param {object|null} afterSnapshot
 * @param {object|null} diff          - resultado de computeRealSnapshotDiff() (opcional)
 * @returns {object[]} [{stepId, actionType, scopedMutations, scopedSideEffects,
 *                        networkCorrelation, correlationBasis, requiresMutation,
 *                        mutationMissing, goNoGo}]
 */
function deriveStepScopedMutations(steps = [], beforeSnapshot = null, afterSnapshot = null, diff = null) {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  return steps.map((step) => {
    const stepId = step?.id || step?.stepId || 'unknown';
    const actionType = step?.actionType || step?.action || step?.type || 'unknown';

    const contractMutations = getExpectedMutationsForStep(step);
    const contractSideEffects = getExpectedSideEffectsForStep(step);

    const incremental = computeIncrementalStepDiff({
      step,
      beforeStepSnapshot: step?.beforeStepSnapshot || null,
      afterStepSnapshot: step?.afterStepSnapshot || null,
    });

    // Mutações do diff incremental atribuíveis a este step pelo contrato
    const scopedMutations = contractMutations.length > 0
      ? incremental.observedMutations.filter((m) =>
          contractMutations.some((cm) => String(m) === String(cm)),
        )
      : incremental.observedMutations;

    const scopedSideEffects = contractSideEffects.length > 0
      ? incremental.observedSideEffects.filter((s) =>
          contractSideEffects.some((cs) => String(s) === String(cs)),
        )
      : incremental.observedSideEffects;

    const networkEvents = Array.isArray(step.networkEvents) ? step.networkEvents : [];
    const matchedNetworkEvent = matchExpectedNetworkEvent(stepId, networkEvents);
    const networkCorrelation = matchedNetworkEvent
      ? [{
          method: matchedNetworkEvent.method || null,
          url: matchedNetworkEvent.url || null,
          status: matchedNetworkEvent.status || null,
          correlatedBy: 'expected_network_event',
        }]
      : [];

    const requiresMutation = isMutationExpectedStep(step);
    const mutationMissing =
      requiresMutation && (!incremental.hasSnapshots
      || !incremental.changed
      || (contractMutations.length > 0 && scopedMutations.length === 0));

    return {
      stepId,
      actionType,
      changed: incremental.changed,
      incrementalDiff: incremental.diff,
      observedMutations: incremental.observedMutations,
      observedSideEffects: incremental.observedSideEffects,
      mutationCount: incremental.mutationCount,
      beforeStepSnapshotPresent: Boolean(step?.beforeStepSnapshot),
      afterStepSnapshotPresent: Boolean(step?.afterStepSnapshot),
      scopedMutations,
      scopedSideEffects,
      networkCorrelation,
      correlationBasis: 'step_incremental',
      requiresMutation,
      mutationMissing,
      goNoGo: mutationMissing ? 'NO_GO' : null,
    };
  });
}

module.exports = {
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
  deriveStepScopedMutations,
  computeIncrementalStepDiff,
  isMutationExpectedStep,
  computeMutationProvenance,
};
