'use strict';

const {
  JOURNEY_STEPS_REGISTRY,
  getOperationalStepContract,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  getEntityScopeForStep,
  isMutationExpectedStep: registryIsMutationExpectedStep,
} = require('../contracts/operationalStepRegistry');

/**
 * evidenceProofValidator.js
 *
 * Prova operacional de evidência — além de verificar que campos existem,
 * verifica que:
 *   - o endpoint CORRETO foi chamado (método + path + status)
 *   - snapshot incremental real ocorreu (before != after)
 *   - mutations/side effects canônicos foram observados por provenance determinística
 *   - snapshotDiff é computado comparando before vs after do próprio step
 *   - a proof chain UI→network→mutation→side-effect→state está completa
 */

// ---------------------------------------------------------------------------
// Network proof contracts / side effects / mutations are derived from the registry.
// ---------------------------------------------------------------------------

function buildContractIndexes() {
  const indexes = {
    network: Object.create(null),
    mutation: Object.create(null),
    sideEffect: Object.create(null),
    actionType: Object.create(null),
  };

  for (const journey of Object.values(JOURNEY_STEPS_REGISTRY || {})) {
    for (const spec of Object.values(journey || {})) {
      if (!spec?.stepId) continue;
      if (spec.networkProofRequired && Array.isArray(spec.networkEndpoints) && spec.networkEndpoints.length > 0) {
        indexes.network[spec.stepId] = spec.networkEndpoints;
      }
      indexes.mutation[spec.stepId] = Array.isArray(spec.expectedMutations) ? spec.expectedMutations : [];
      indexes.sideEffect[spec.stepId] = Array.isArray(spec.expectedSideEffects) ? spec.expectedSideEffects : [];

      if (spec.actionType && !indexes.actionType[spec.actionType]) {
        indexes.actionType[spec.actionType] = spec;
      }
    }
  }

  return indexes;
}

const CONTRACT_INDEXES = buildContractIndexes();
const NETWORK_PROOF_CONTRACTS = CONTRACT_INDEXES.network;
const MUTATION_PROOF_CONTRACTS = CONTRACT_INDEXES.mutation;
const SIDE_EFFECT_PROOF_CONTRACTS = CONTRACT_INDEXES.sideEffect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchMethod(method = '', pattern) {
  if (pattern instanceof RegExp) return pattern.test(String(method).toUpperCase());
  if (typeof pattern === 'string' && pattern.includes('|')) {
    return pattern
      .split('|')
      .map((item) => item.trim().toUpperCase())
      .includes(String(method).toUpperCase());
  }
  return String(method).toUpperCase() === String(pattern).toUpperCase();
}

function matchPath(url = '', pattern) {
  if (pattern instanceof RegExp) return pattern.test(url);
  return String(url) === String(pattern);
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

function getOperationalContractForProof(stepId = '', actionType = '') {
  const normalizedStepId = String(stepId || '').trim();
  if (normalizedStepId) {
    return getOperationalStepContract(normalizedStepId);
  }
  return CONTRACT_INDEXES.actionType[actionType] || null;
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
  const contract = getOperationalContractForProof(stepId, actionType);

  if (!contract) {
    return {
      valid: false,
      matched: [],
      missing: ['operational_step_contract_missing'],
      blockers: [{ reason: 'operational_step_contract_missing', stepId, actionType }],
      noContract: false,
    };
  }

  if (contract.networkProofRequired !== true || !Array.isArray(contract.networkEndpoints) || contract.networkEndpoints.length === 0) {
    return { valid: true, matched: [], missing: [], blockers: [], noContract: true };
  }

  const responses = getResponses(networkEvents);
  const matched = [];
  const missing = [];
  const blockers = [];

  for (const endpoint of contract.networkEndpoints) {
    const hit = responses.find(
      (e) =>
        matchMethod(e.method, endpoint.method) &&
        matchPath(e.url, endpoint.pathPattern) &&
        matchStatus(e.status, endpoint.status),
    );

    if (hit) {
      matched.push({ contract: endpoint, event: hit });
    } else {
      const desc = `${String(endpoint.method)} ${endpoint.pathPattern} [${(endpoint.status || []).join(',')}]`;
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
 * Compara dois snapshots (before / after) e retorna apenas o diff estrutural.
 * Este helper NÃO infere mutation ids. Mutation proof operacional é derivado
 * exclusivamente por regras canônicas exatas no postStateProofValidator.
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

  const details = [];

  function diffObject(b, a, prefix = '') {
    if (typeof b !== 'object' || typeof a !== 'object' || b == null || a == null) {
      if (b !== a) {
        details.push({ field: prefix || 'root', before: b, after: a });
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
      }
    }
  }

  diffObject(before, after);

  return {
    changed: details.length > 0,
    mutations: [],
    sideEffects: [],
    mutationCount: 0,
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
  const allMutations = [...(observedMutations || [])];
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
  const operationalContract = getOperationalContractForProof(stepId, actionType);
  const expectedMutations = operationalContract ? getExpectedMutationsForStep(operationalContract) : [];

  const missingExpectedMutations = expectedMutations.filter(
    (m) => !allMutations.some((obs) => String(obs) === String(m)),
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
    (getOperationalContractForProof(stepId, actionType)
      ? getExpectedSideEffectsForStep(getOperationalContractForProof(stepId, actionType))
      : []);

  if (expectedSideEffects.length === 0) {
    return { valid: true, observed: observedSideEffects, missing: [], blockers: [], noContract: true };
  }

  const observed = observedSideEffects || [];
  const missing = expectedSideEffects.filter(
    (se) => !observed.some((obs) => String(obs) === String(se)),
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

  const operationalContract = getOperationalContractForProof(stepId, actionType);
  if (!operationalContract) {
    return {
      valid: false,
      stepId,
      actionType,
      networkProof: { valid: false, matched: [], missing: ['operational_step_contract_missing'], blockers: [{ reason: 'operational_step_contract_missing', stepId, actionType }], noContract: false, expectedEndpoints: [], observedEndpoints: getResponses(events).map((e) => `${e.method} ${e.url} [${e.status}]`) },
      mutationProof: { valid: false, diff: null, observedMutations, mutationCount: 0, blockers: [{ reason: 'operational_step_contract_missing', stepId, actionType }], expectedMutations: [] },
      sideEffectProof: { valid: false, observed: observedSideEffects, missing: [], blockers: [{ reason: 'operational_step_contract_missing', stepId, actionType }], expectedSideEffects: [] },
      realSnapshotDiff: computeRealSnapshotDiff(beforeSnapshot, afterSnapshot),
      proofChain: { uiAction: Boolean(step?.selectorUsed || evidence?.selectorUsed || step?.actionType), networkProof: false, mutationProof: false, sideEffectProof: false, finalStateProof: Boolean(afterSnapshot), complete: false },
      blockers: [{ reason: 'operational_step_contract_missing', stepId, actionType }],
      goNoGo: blocking ? (executionMode === 'diagnostic' ? 'REVIEW' : 'NO_GO') : null,
    };
  }

  const stepRequiresNetworkProof = operationalContract.networkProofRequired === true;
  const stepRequiresMutationProof = operationalContract.mutationExpected === true;
  const expectedSideEffectsForContract = getExpectedSideEffectsForStep(operationalContract);
  const stepRequiresSideEffectProof = expectedSideEffectsForContract.length > 0;

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
      expectedEndpoints: Array.isArray(operationalContract.networkEndpoints)
        ? operationalContract.networkEndpoints.map((c) => `${String(c.method)} ${c.pathPattern} [${(c.status || []).join(',')}]`)
        : [],
      observedEndpoints: getResponses(events).map((e) => `${e.method} ${e.url} [${e.status}]`),
    },
    mutationProof: {
      ...mutationProof,
      expectedMutations: getExpectedMutationsForStep(operationalContract),
    },
    sideEffectProof: {
      ...sideEffectProof,
      expectedSideEffects: expectedSideEffectsForContract,
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
