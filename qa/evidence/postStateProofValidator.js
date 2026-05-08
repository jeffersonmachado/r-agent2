'use strict';

/**
 * postStateProofValidator.js
 *
 * POST-STATE proof: executado APÓS collectAfterSnapshot().
 *
 * Valida o que só é possível provar depois de ter o afterSnapshot real:
 *   - snapshot diff real (before !== after)
 *   - observedMutations derivadas do diff (não expectedMutations como proxy)
 *   - observedSideEffects derivados do diff
 *   - mutationCount > 0
 *   - estado final comprovado
 *
 * Pipeline obrigatório para chamar este módulo:
 *   1. executeStep()
 *   2. validateStepExecutionProof()   ← já passou
 *   3. collectAfterSnapshot()         ← obrigatório antes deste módulo
 *   4. computeRealSnapshotDiff()
 *   5. deriveObservedMutations(diff)
 *   6. deriveObservedSideEffects(diff)
 *   7. validatePostStateProof()       ← este módulo
 *   8. appendProofChainToReplay()
 */

const { computeRealSnapshotDiff } = require('./evidenceProofValidator');

// ---------------------------------------------------------------------------
// Derivation rules: campo do diff → mutação observada
// ---------------------------------------------------------------------------

/**
 * Regras de derivação campo → mutation.
 * Cada regra: { match: fn(fieldPath, before, after), mutation: string }
 */
const MUTATION_DERIVATION_RULES = [
  // Messages / tickets
  {
    match: (f, b, a) => /messages?_?count/i.test(f) && Number(a) > Number(b),
    mutation: 'message_created',
  },
  {
    match: (f, b, a) => /messages?_?count/i.test(f) && Number(a) < Number(b),
    mutation: 'message_deleted',
  },
  // Ticket status
  {
    match: (f, b, a) => /^(status|ticket_?status)$/i.test(f) && b !== a,
    mutation: 'ticket_status_changed',
  },
  // Attendance / checkin
  {
    match: (f, b, a) => /attendance_?count/i.test(f) && Number(a) > Number(b),
    mutation: 'attendance_created',
  },
  {
    match: (f, b, a) => /access_?decision/i.test(f) && b !== a,
    mutation: 'access_decision_created',
  },
  {
    match: (f, b, a) => /subject_?identified|subject_?id/i.test(f) && !b && a,
    mutation: 'subject_identified',
  },
  // Access events
  {
    match: (f, b, a) => /access_?event_?count/i.test(f) && Number(a) > Number(b),
    mutation: 'access_event_created',
  },
  // Generic item count up
  {
    match: (f, b, a) => /(items?|total|count)$/i.test(f) && Number(a) > Number(b),
    mutation: 'item_created',
  },
  // Generic field changed (fallback)
  {
    match: (f, b, a) => b !== a,
    mutation: (f) => `field_changed:${f}`,
  },
];

/**
 * Regras de derivação campo do diff → side effect observado.
 * Ativadas por mudanças de campos correlacionados.
 */
const SIDE_EFFECT_DERIVATION_RULES = [
  // CRM / activities
  {
    match: (f) => /crm_?activit|crm_?updat/i.test(f),
    sideEffect: 'crm_updated',
  },
  {
    match: (f) => /crm_?journ/i.test(f),
    sideEffect: 'crm_journey_updated',
  },
  {
    match: (f) => /crm_?presence/i.test(f),
    sideEffect: 'crm_presence_updated',
  },
  // Audit log
  {
    match: (f) => /audit_?log|audit_?count/i.test(f),
    sideEffect: 'audit_log_created',
  },
  // Notifications
  {
    match: (f) => /notification/i.test(f),
    sideEffect: 'notification_sent',
  },
  // Access events
  {
    match: (f) => /access_?event/i.test(f),
    sideEffect: 'access_event_created',
  },
  // Presence / attendance trigger CRM journey update
  {
    match: (f) => /attendance_?count/i.test(f),
    sideEffect: 'crm_journey_updated',
  },
  // Ticket status change triggers audit
  {
    match: (f) => /^(status|ticket_?status)$/i.test(f),
    sideEffect: 'audit_log_created',
  },
  // Message created triggers audit + CRM
  {
    match: (f) => /messages?_?count/i.test(f),
    sideEffect: 'audit_log_created',
  },
  {
    match: (f) => /messages?_?count/i.test(f),
    sideEffect: 'crm_updated',
  },
];

// ---------------------------------------------------------------------------
// Mutation derivation engine
// ---------------------------------------------------------------------------

/**
 * Deriva as mutações OBSERVADAS a partir do diff real.
 *
 * Usa as regras de derivação para mapear cada detalhe de diff em
 * uma ou mais mutações observadas concretas.
 *
 * @param {object} diff - resultado de computeRealSnapshotDiff()
 * @returns {string[]} observedMutations
 */
function deriveObservedMutations(diff = {}) {
  if (!diff || !diff.changed || !Array.isArray(diff.details) || diff.details.length === 0) {
    return [];
  }

  const mutations = new Set();

  for (const detail of diff.details) {
    const fieldPath = String(detail.field || '').toLowerCase();
    const before = detail.before;
    const after = detail.after;

    for (const rule of MUTATION_DERIVATION_RULES) {
      if (rule.match(fieldPath, before, after)) {
        const mutation = typeof rule.mutation === 'function'
          ? rule.mutation(fieldPath)
          : rule.mutation;
        mutations.add(mutation);
        // Pare no primeiro match que não seja o fallback genérico
        if (rule.mutation !== MUTATION_DERIVATION_RULES[MUTATION_DERIVATION_RULES.length - 1].mutation) {
          break;
        }
      }
    }
  }

  // Inclui mutações já presentes no diff (de computeRealSnapshotDiff)
  for (const m of diff.mutations || []) {
    mutations.add(m);
  }

  return Array.from(mutations);
}

/**
 * Deriva os side effects OBSERVADOS a partir do diff real.
 *
 * @param {object} diff - resultado de computeRealSnapshotDiff()
 * @returns {string[]} observedSideEffects
 */
function deriveObservedSideEffects(diff = {}) {
  if (!diff || !diff.changed || !Array.isArray(diff.details) || diff.details.length === 0) {
    return [];
  }

  const sideEffects = new Set();

  for (const detail of diff.details) {
    const fieldPath = String(detail.field || '').toLowerCase();

    for (const rule of SIDE_EFFECT_DERIVATION_RULES) {
      if (rule.match(fieldPath)) {
        sideEffects.add(rule.sideEffect);
      }
    }
  }

  // Inclui side effects já presentes no diff (de computeRealSnapshotDiff)
  for (const se of diff.sideEffects || []) {
    sideEffects.add(se);
  }

  return Array.from(sideEffects);
}

// ---------------------------------------------------------------------------
// Expected proof contracts por actionType / stepId
// ---------------------------------------------------------------------------

const POST_STATE_MUTATION_CONTRACTS = {
  step_reply_ticket: ['message_created'],
  step_change_status: ['ticket_status_changed'],
  step_identify_customer: ['access_decision_created'],
  step_assert_access_decision: ['access_decision_created'],
  step_assert_attendance: ['attendance_created'],
  type_and_send: ['message_created'],
  change_status: ['ticket_status_changed'],
  checkin_submit: ['access_decision_created'],
};

const POST_STATE_SIDE_EFFECT_CONTRACTS = {
  step_reply_ticket: ['audit_log_created', 'crm_updated'],
  step_change_status: ['audit_log_created'],
  step_assert_attendance: ['crm_journey_updated'],
  type_and_send: ['audit_log_created'],
  change_status: ['audit_log_created'],
};

/**
 * ActionTypes que requerem validação de post-state proof.
 */
const POST_STATE_REQUIRED_TYPES = new Set([
  'type_and_send',
  'change_status',
  'checkin_submit',
  'assert_attendance',
]);

const POST_STATE_REQUIRED_STEP_IDS = new Set([
  'step_reply_ticket',
  'step_change_status',
  'step_identify_customer',
  'step_assert_access_decision',
  'step_assert_attendance',
]);

// ---------------------------------------------------------------------------
// validatePostStateProof
// ---------------------------------------------------------------------------

/**
 * Valida o estado pós-execução: snapshot diff real, mutações observadas,
 * side effects observados, e estado final.
 *
 * DEVE ser chamado somente após:
 *   - afterSnapshot coletado
 *   - diff computado via computeRealSnapshotDiff(before, after)
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
  journeyContext = {},
} = {}) {
  const stepId = step.id || step.stepId || 'unknown';
  const actionType = step.actionType || 'unknown';
  const blocking = Boolean(journeyContext.isBlockingJourney);
  const executionMode = String(journeyContext.executionMode || 'operational_go').toLowerCase();

  const requiresPostState =
    POST_STATE_REQUIRED_TYPES.has(actionType) || POST_STATE_REQUIRED_STEP_IDS.has(stepId);

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

  // ── 1. Compute real snapshot diff ─────────────────────────────────────────
  const diff = computeRealSnapshotDiff(beforeSnapshot, afterSnapshot);

  // ── 2. Derive observed mutations e side effects ───────────────────────────
  const observedMutations = deriveObservedMutations(diff);
  const observedSideEffects = deriveObservedSideEffects(diff);
  const mutationCount = observedMutations.length;

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

  // ── 3. Snapshot must have changed ────────────────────────────────────────
  if (!diff.changed) {
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

  // ── 5. Validate expected mutations por contrato ───────────────────────────
  const expectedMutations =
    POST_STATE_MUTATION_CONTRACTS[stepId] || POST_STATE_MUTATION_CONTRACTS[actionType] || [];

  const missingMutations = expectedMutations.filter(
    (em) => !observedMutations.some(
      (om) => om === em || om.startsWith(em) || em.startsWith(om.split(':')[0]),
    ),
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

  // ── 6. Validate expected side effects por contrato ────────────────────────
  const expectedSideEffects =
    POST_STATE_SIDE_EFFECT_CONTRACTS[stepId] || POST_STATE_SIDE_EFFECT_CONTRACTS[actionType] || [];

  const missingSideEffects = expectedSideEffects.filter(
    (es) => !observedSideEffects.some(
      (os) => os === es || os.includes(es) || es.includes(os),
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
 * Usa o diff global da jornada + contratos de actionType/stepId para determinar
 * quais mutações são atribuíveis a cada step.  Retorna goNoGo='NO_GO' para
 * qualquer step que exige mutação por contrato mas nenhuma foi observada no diff.
 *
 * Pipeline esperado:
 *   executeOperationalSteps() → collectAfterSnapshot() → computeRealSnapshotDiff()
 *   → deriveStepScopedMutations()   ← este módulo
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

  const activeDiff = diff || computeRealSnapshotDiff(beforeSnapshot, afterSnapshot);
  const allMutations = deriveObservedMutations(activeDiff);
  const allSideEffects = deriveObservedSideEffects(activeDiff);

  return steps.map((step) => {
    const stepId = step?.id || step?.stepId || 'unknown';
    const actionType = step?.actionType || step?.action || step?.type || 'unknown';

    const contractMutations =
      POST_STATE_MUTATION_CONTRACTS[stepId] || POST_STATE_MUTATION_CONTRACTS[actionType] || [];
    const contractSideEffects =
      POST_STATE_SIDE_EFFECT_CONTRACTS[stepId] || POST_STATE_SIDE_EFFECT_CONTRACTS[actionType] || [];

    // Mutações do diff atribuíveis a este step pelo contrato
    const scopedMutations =
      contractMutations.length > 0
        ? allMutations.filter((m) =>
            contractMutations.some(
              (cm) => m === cm || m.startsWith(cm) || cm.startsWith(m.split(':')[0]),
            ),
          )
        : POST_STATE_REQUIRED_TYPES.has(actionType) || POST_STATE_REQUIRED_STEP_IDS.has(stepId)
          ? allMutations
          : [];

    const scopedSideEffects =
      contractSideEffects.length > 0
        ? allSideEffects.filter((s) =>
            contractSideEffects.some((cs) => s === cs || s.includes(cs) || cs.includes(s)),
          )
        : [];

    // Correlação via network events do step (evidência de causalidade)
    const networkEvents = Array.isArray(step.networkEvents) ? step.networkEvents : [];
    const networkCorrelation = networkEvents
      .filter((e) => e.type === 'response' && Number(e.status) >= 200 && Number(e.status) < 300)
      .map((e) => ({ method: e.method || null, url: e.url || null, status: e.status || null }));

    const requiresMutation =
      POST_STATE_REQUIRED_TYPES.has(actionType) || POST_STATE_REQUIRED_STEP_IDS.has(stepId);
    const mutationMissing =
      requiresMutation && contractMutations.length > 0 && scopedMutations.length === 0;

    return {
      stepId,
      actionType,
      scopedMutations,
      scopedSideEffects,
      networkCorrelation,
      correlationBasis: contractMutations.length > 0 ? 'contract' : 'inferred',
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
  POST_STATE_MUTATION_CONTRACTS,
  POST_STATE_SIDE_EFFECT_CONTRACTS,
  POST_STATE_REQUIRED_TYPES,
};
