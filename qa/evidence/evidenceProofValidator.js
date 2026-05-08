'use strict';

/**
 * evidenceProofValidator.js
 *
 * Prova operacional de evidência — além de verificar que campos existem,
 * verifica que:
 *   - o endpoint CORRETO foi chamado (método + path + status)
 *   - mutação REAL ocorreu (before != after, mutationCount > 0)
 *   - side effects REAIS foram observados
 *   - snapshotDiff é computado comparando before vs after (não estático)
 *   - a proof chain UI→network→mutation→side-effect→state está completa
 */

// ---------------------------------------------------------------------------
// Network proof contracts por actionType/stepId
// ---------------------------------------------------------------------------

/**
 * Mapa de contratos de proof de rede por stepId e actionType.
 * Cada entrada define endpoints esperados: { method, pathPattern, status }.
 */
const NETWORK_PROOF_CONTRACTS = {
  // Support flow
  step_reply_ticket: [
    { method: 'POST', pathPattern: /\/tickets\/[^/]+\/reply/, status: [200, 201] },
  ],
  step_change_status: [
    { method: 'PATCH', pathPattern: /\/tickets\/[^/]+\/(status|change-status)/, status: [200, 201] },
  ],
  // Fitness flow
  step_identify_customer: [
    {
      method: 'POST',
      pathPattern: /\/(checkin|access-control\/decisions\/resolve|access\/checkin|fitness\/checkin)/,
      status: [200, 201],
    },
  ],
  step_assert_access_decision: [
    {
      method: /GET|POST/,
      pathPattern: /\/access-control\/(decisions|events)/,
      status: [200, 201],
    },
  ],
  step_assert_attendance: [
    {
      method: /GET|POST/,
      pathPattern: /\/fitness\/(attendance|subject)/,
      status: [200, 201],
    },
  ],
  // actionType-level fallback contracts
  type_and_send: [
    { method: /POST|PUT|PATCH/, pathPattern: /.*/, status: [200, 201, 204] },
  ],
  change_status: [
    { method: /PATCH|PUT|POST/, pathPattern: /.*/, status: [200, 201, 204] },
  ],
  checkin_submit: [
    { method: 'POST', pathPattern: /.*/, status: [200, 201, 204] },
  ],
};

/**
 * Side effects esperados por stepId / actionType.
 */
const SIDE_EFFECT_PROOF_CONTRACTS = {
  step_reply_ticket: ['message_created', 'audit_log_created', 'crm_updated'],
  step_change_status: ['ticket_status_changed', 'audit_log_created'],
  step_identify_customer: ['access_policy_evaluated'],
  step_assert_access_decision: ['access_decision_allow', 'access_event_created'],
  step_assert_attendance: ['attendance_created', 'crm_presence_updated'],
  type_and_send: ['message_created', 'audit_log_created'],
  change_status: ['ticket_status_changed'],
  checkin_submit: ['access_policy_evaluated'],
  assert_attendance: ['attendance_created'],
};

/**
 * Mutações esperadas por stepId / actionType.
 */
const MUTATION_PROOF_CONTRACTS = {
  step_reply_ticket: ['message_created'],
  step_change_status: ['ticket_status_changed'],
  step_identify_customer: ['subject_identified', 'access_decision_created'],
  step_assert_access_decision: ['access_decision_allow'],
  step_assert_attendance: ['attendance_created'],
  type_and_send: ['message_created'],
  change_status: ['ticket_status_changed'],
  checkin_submit: ['access_decision_created'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchMethod(method = '', pattern) {
  if (pattern instanceof RegExp) return pattern.test(String(method).toUpperCase());
  return String(method).toUpperCase() === String(pattern).toUpperCase();
}

function matchPath(url = '', pattern) {
  if (pattern instanceof RegExp) return pattern.test(url);
  return String(url).includes(String(pattern));
}

function matchStatus(status, allowed) {
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(Number(status));
}

/**
 * Filtra network events da lista para os que são respostas completadas.
 */
function getResponses(networkEvents = []) {
  return (networkEvents || []).filter((e) => e?.type === 'response' && e?.status != null);
}

// ---------------------------------------------------------------------------
// 1. Network Proof
// ---------------------------------------------------------------------------

/**
 * Verifica que o endpoint correto (método + path + status) está nos eventos
 * de rede capturados durante o step.
 *
 * @param {object[]} networkEvents - eventos capturados durante o step
 * @param {string} stepId
 * @param {string} actionType
 * @returns {{ valid: boolean, matched: object[], missing: string[], blockers: object[] }}
 */
function validateNetworkProof(networkEvents = [], stepId = '', actionType = '') {
  const contracts =
    NETWORK_PROOF_CONTRACTS[stepId] ||
    NETWORK_PROOF_CONTRACTS[actionType] ||
    null;

  // Sem contrato específico: pass-through (não bloqueia)
  if (!contracts || contracts.length === 0) {
    return { valid: true, matched: [], missing: [], blockers: [], noContract: true };
  }

  const responses = getResponses(networkEvents);
  const matched = [];
  const missing = [];
  const blockers = [];

  for (const contract of contracts) {
    const hit = responses.find(
      (e) =>
        matchMethod(e.method, contract.method) &&
        matchPath(e.url, contract.pathPattern) &&
        matchStatus(e.status, contract.status),
    );

    if (hit) {
      matched.push({ contract, event: hit });
    } else {
      const desc = `${String(contract.method)} ${contract.pathPattern} [${(contract.status || []).join(',')}]`;
      missing.push(desc);
      blockers.push({
        reason: 'network_proof_missing_endpoint',
        stepId,
        actionType,
        expected: desc,
        observed: responses.map((e) => `${e.method} ${e.url} [${e.status}]`),
      });
    }
  }

  return {
    valid: missing.length === 0,
    matched,
    missing,
    blockers,
    noContract: false,
  };
}

// ---------------------------------------------------------------------------
// 2. Mutation Proof — computeRealSnapshotDiff
// ---------------------------------------------------------------------------

/**
 * Compara dois snapshots (before / after) e retorna diff real com
 * mutações observadas e contagem.
 *
 * Aceita snapshots estruturados como objetos ou arrays.
 *
 * @param {object|null} before
 * @param {object|null} after
 * @returns {{
 *   changed: boolean,
 *   mutations: string[],
 *   sideEffects: string[],
 *   mutationCount: number,
 *   details: object[]
 * }}
 */
function computeRealSnapshotDiff(before, after) {
  if (before == null || after == null) {
    return {
      changed: false,
      mutations: [],
      sideEffects: [],
      mutationCount: 0,
      details: [{ reason: 'snapshot_null', before: before == null, after: after == null }],
    };
  }

  const mutations = [];
  const sideEffects = [];
  const details = [];

  // Heurísticas de diff por campos convencionais
  const COUNTER_FIELDS = [
    'messages_count', 'messagesCount', 'message_count', 'messageCount',
    'count', 'total', 'items_count', 'itemsCount',
    'attendance_count', 'attendanceCount',
    'events_count', 'eventsCount',
    'activities_count', 'activitiesCount',
  ];

  const STATUS_FIELDS = [
    'status', 'ticket_status', 'ticketStatus',
    'access_decision', 'decision',
    'membership_status', 'membershipStatus',
  ];

  const SIDE_EFFECT_FIELDS = [
    'audit_log_count', 'auditLogCount',
    'crm_activities_count', 'crmActivitiesCount',
    'notifications_sent', 'notificationsSent',
  ];

  // Conta campos escalares que mudaram
  function diffObject(b, a, prefix = '') {
    if (typeof b !== 'object' || typeof a !== 'object' || b == null || a == null) {
      if (b !== a) {
        details.push({ field: prefix || 'root', before: b, after: a });
        mutations.push(`field_changed:${prefix || 'root'}`);
      }
      return;
    }

    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const key of keys) {
      const bVal = b[key];
      const aVal = a[key];
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (typeof bVal === 'object' && typeof aVal === 'object') {
        diffObject(bVal, aVal, fieldPath);
        continue;
      }

      if (bVal !== aVal) {
        details.push({ field: fieldPath, before: bVal, after: aVal });

        const lkey = key.toLowerCase();
        if (COUNTER_FIELDS.some((f) => f.toLowerCase() === lkey)) {
          const bNum = Number(bVal || 0);
          const aNum = Number(aVal || 0);
          if (aNum > bNum) mutations.push(`${lkey}_incremented`);
          else mutations.push(`${lkey}_changed`);
        } else if (STATUS_FIELDS.some((f) => f.toLowerCase() === lkey)) {
          mutations.push(`${lkey}_changed:${bVal}=>${aVal}`);
        } else if (SIDE_EFFECT_FIELDS.some((f) => f.toLowerCase() === lkey)) {
          sideEffects.push(`${lkey}_changed`);
        } else {
          mutations.push(`field_changed:${fieldPath}`);
        }
      }
    }
  }

  diffObject(before, after);

  return {
    changed: mutations.length > 0 || sideEffects.length > 0,
    mutations,
    sideEffects,
    mutationCount: mutations.length,
    details,
  };
}

/**
 * Valida que a mutação de estado REAL ocorreu.
 *
 * @param {object|null} beforeSnapshot
 * @param {object|null} afterSnapshot
 * @param {object[]} observedMutations - mutações já observadas via outros meios
 * @param {string} stepId
 * @param {string} actionType
 * @returns {{ valid: boolean, diff: object, blockers: object[] }}
 */
function validateMutationProof(beforeSnapshot, afterSnapshot, observedMutations = [], stepId = '', actionType = '') {
  const diff = computeRealSnapshotDiff(beforeSnapshot, afterSnapshot);
  const allMutations = [...diff.mutations, ...(observedMutations || [])];
  const mutationCount = allMutations.length;

  const blockers = [];

  if (!diff.changed && mutationCount === 0) {
    blockers.push({
      reason: 'mutation_proof_no_real_mutation',
      stepId,
      actionType,
      snapshotBefore: beforeSnapshot != null,
      snapshotAfter: afterSnapshot != null,
      mutationCount: 0,
    });
  }

  if (beforeSnapshot == null) {
    blockers.push({ reason: 'mutation_proof_missing_before_snapshot', stepId, actionType });
  }

  if (afterSnapshot == null) {
    blockers.push({ reason: 'mutation_proof_missing_after_snapshot', stepId, actionType });
  }

  // Verificar mutações esperadas por contrato
  const expectedMutations =
    MUTATION_PROOF_CONTRACTS[stepId] ||
    MUTATION_PROOF_CONTRACTS[actionType] ||
    [];

  const missingExpectedMutations = expectedMutations.filter(
    (m) => !allMutations.some((obs) => String(obs).includes(m) || m.includes(String(obs).split(':')[0])),
  );

  if (missingExpectedMutations.length > 0) {
    blockers.push({
      reason: 'mutation_proof_expected_not_observed',
      stepId,
      actionType,
      expectedMutations,
      observedMutations: allMutations,
      missingMutations: missingExpectedMutations,
    });
  }

  return {
    valid: blockers.length === 0,
    diff,
    observedMutations: allMutations,
    mutationCount,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// 3. Side Effect Proof
// ---------------------------------------------------------------------------

/**
 * Valida que os side effects esperados foram realmente observados.
 *
 * @param {string[]} observedSideEffects
 * @param {string} stepId
 * @param {string} actionType
 * @param {string[]} [overrideExpected]
 * @returns {{ valid: boolean, observed: string[], missing: string[], blockers: object[] }}
 */
function validateSideEffectProof(observedSideEffects = [], stepId = '', actionType = '', overrideExpected = null) {
  const expectedSideEffects =
    overrideExpected ||
    SIDE_EFFECT_PROOF_CONTRACTS[stepId] ||
    SIDE_EFFECT_PROOF_CONTRACTS[actionType] ||
    [];

  if (expectedSideEffects.length === 0) {
    return { valid: true, observed: observedSideEffects, missing: [], blockers: [], noContract: true };
  }

  const observed = observedSideEffects || [];
  const missing = expectedSideEffects.filter(
    (se) => !observed.some((obs) => String(obs).includes(se) || se.includes(obs)),
  );

  const blockers = missing.map((se) => ({
    reason: 'side_effect_proof_not_observed',
    stepId,
    actionType,
    missingSideEffect: se,
    expectedSideEffects,
    observedSideEffects: observed,
  }));

  return {
    valid: missing.length === 0,
    observed,
    missing,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// 4. Proof Chain — validateEvidenceProof (entry point)
// ---------------------------------------------------------------------------

/**
 * Valida a proof chain completa:
 *   UI action → network proof → mutation proof → side effect proof → final state proof
 *
 * @param {object} params
 * @param {object} params.step  - step enriquecido (com networkEvents, mutationLinkage, etc.)
 * @param {object} params.evidence - evidence object (pode ser o próprio step)
 * @param {object|null} params.beforeSnapshot
 * @param {object|null} params.afterSnapshot
 * @param {object[]} params.networkEvents - eventos do step (step-scoped)
 * @param {object} params.journeyContext
 * @returns {EvidenceProofResult}
 */
function validateEvidenceProof({
  step = {},
  evidence = {},
  beforeSnapshot = null,
  afterSnapshot = null,
  networkEvents = null,
  journeyContext = {},
} = {}) {
  const stepId = step?.id || step?.stepId || evidence?.id || 'unknown';
  const actionType = step?.actionType || step?.action || evidence?.actionType || 'unknown';
  const blocking = Boolean(journeyContext?.isBlockingJourney);
  const executionMode = String(journeyContext?.executionMode || 'operational_go').toLowerCase();

  // Usar networkEvents do step se não passado explicitamente
  const events = networkEvents || step?.networkEvents || evidence?.networkEvents || [];

  // Coletar observedMutations e observedSideEffects de várias fontes
  const mutationLinkage = step?.mutationLinkage || evidence?.mutationLinkage || {};
  const sideEffectLinkage = step?.sideEffectLinkage || evidence?.sideEffectLinkage || {};
  const observedMutations = [
    ...(Array.isArray(mutationLinkage?.observedMutations) ? mutationLinkage.observedMutations : []),
    ...(Array.isArray(evidence?.observedMutations) ? evidence.observedMutations : []),
  ];
  const observedSideEffects = [
    ...(Array.isArray(sideEffectLinkage?.observedSideEffects) ? sideEffectLinkage.observedSideEffects : []),
    ...(Array.isArray(mutationLinkage?.observedSideEffects) ? mutationLinkage.observedSideEffects : []),
    ...(Array.isArray(evidence?.observedSideEffects) ? evidence.observedSideEffects : []),
  ];

  // Decidir se este actionType requer provas de mutação
  const MUTATION_REQUIRED_TYPES = new Set([
    'type_and_send', 'change_status', 'checkin_submit',
  ]);
  const SIDE_EFFECT_REQUIRED_TYPES = new Set([
    'type_and_send', 'change_status', 'checkin_submit', 'assert_attendance',
  ]);
  const NETWORK_REQUIRED_TYPES = new Set([
    'type_and_send', 'change_status', 'checkin_submit',
  ]);

  const requiresMutationProof = MUTATION_REQUIRED_TYPES.has(actionType);
  const requiresSideEffectProof = SIDE_EFFECT_REQUIRED_TYPES.has(actionType);
  const requiresNetworkProof = NETWORK_REQUIRED_TYPES.has(actionType);

  // Step-specific overrides (step definitions can also require proof for specific IDs)
  const stepRequiresNetworkProof = requiresNetworkProof || Boolean(NETWORK_PROOF_CONTRACTS[stepId]);
  const stepRequiresMutationProof = requiresMutationProof || Boolean(MUTATION_PROOF_CONTRACTS[stepId]);
  const stepRequiresSideEffectProof = requiresSideEffectProof || Boolean(SIDE_EFFECT_PROOF_CONTRACTS[stepId]);

  const allBlockers = [];

  // ── 1. Network proof ──────────────────────────────────────────────────────
  let networkProof = { valid: true, matched: [], missing: [], blockers: [], noContract: true };
  if (stepRequiresNetworkProof) {
    networkProof = validateNetworkProof(events, stepId, actionType);
    if (!networkProof.valid) allBlockers.push(...networkProof.blockers);
  }

  // ── 2. Mutation proof ─────────────────────────────────────────────────────
  let mutationProof = { valid: true, diff: null, observedMutations: [], mutationCount: 0, blockers: [] };
  if (stepRequiresMutationProof) {
    mutationProof = validateMutationProof(beforeSnapshot, afterSnapshot, observedMutations, stepId, actionType);
    if (!mutationProof.valid) allBlockers.push(...mutationProof.blockers);
  }

  // ── 3. Side effect proof ──────────────────────────────────────────────────
  let sideEffectProof = { valid: true, observed: [], missing: [], blockers: [], noContract: true };
  if (stepRequiresSideEffectProof) {
    sideEffectProof = validateSideEffectProof(observedSideEffects, stepId, actionType);
    if (!sideEffectProof.valid) allBlockers.push(...sideEffectProof.blockers);
  }

  // ── 4. Compute real snapshotDiff (sempre, como diagnóstico) ───────────────
  const realSnapshotDiff = computeRealSnapshotDiff(beforeSnapshot, afterSnapshot);

  // ── 5. Proof chain summary ────────────────────────────────────────────────
  const proofChain = {
    uiAction: Boolean(step?.selectorUsed || evidence?.selectorUsed || step?.actionType),
    networkProof: networkProof.valid,
    mutationProof: mutationProof.valid,
    sideEffectProof: sideEffectProof.valid,
    finalStateProof: Boolean(afterSnapshot),
    complete:
      (networkProof.valid || networkProof.noContract) &&
      (mutationProof.valid || !stepRequiresMutationProof) &&
      (sideEffectProof.valid || !stepRequiresSideEffectProof),
  };

  const valid = allBlockers.length === 0;
  let goNoGo = null;
  if (!valid && blocking) {
    goNoGo = executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO';
  }

  return {
    valid,
    stepId,
    actionType,
    networkProof: {
      ...networkProof,
      expectedEndpoints: (NETWORK_PROOF_CONTRACTS[stepId] || NETWORK_PROOF_CONTRACTS[actionType] || []).map(
        (c) => `${String(c.method)} ${c.pathPattern} [${(c.status || []).join(',')}]`,
      ),
      observedEndpoints: getResponses(events).map((e) => `${e.method} ${e.url} [${e.status}]`),
    },
    mutationProof: {
      ...mutationProof,
      expectedMutations: MUTATION_PROOF_CONTRACTS[stepId] || MUTATION_PROOF_CONTRACTS[actionType] || [],
    },
    sideEffectProof: {
      ...sideEffectProof,
      expectedSideEffects: SIDE_EFFECT_PROOF_CONTRACTS[stepId] || SIDE_EFFECT_PROOF_CONTRACTS[actionType] || [],
    },
    realSnapshotDiff,
    proofChain,
    blockers: allBlockers,
    goNoGo,
  };
}

module.exports = {
  validateEvidenceProof,
  validateNetworkProof,
  validateMutationProof,
  validateSideEffectProof,
  computeRealSnapshotDiff,
  NETWORK_PROOF_CONTRACTS,
  MUTATION_PROOF_CONTRACTS,
  SIDE_EFFECT_PROOF_CONTRACTS,
};
