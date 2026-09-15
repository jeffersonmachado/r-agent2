'use strict';

/**
 * holdoutPreregistration — PRÉ-REGISTRO do holdout e verificação de leakage.
 *
 * O holdout é escolhido ANTES de qualquer pesquisa profunda. O registro
 * persiste `selectedAt`, `selectionBasis` e `preregistered=true`; abrir a
 * pesquisa profunda sobre o holdout sem pré-registro, ou constatar que a
 * pesquisa profunda começou ANTES do pré-registro, é LEAKAGE → FAIL.
 *
 * Semântica consistente com `evaluateHoldout` de
 * `qa/benchmarks/benchmarkSufficiencyEngine.js`:
 *   - ausência de pré-registro        → holdout_not_preregistered;
 *   - análise anterior ao pré-registro → holdout_leakage_analyzed_before_preregistration;
 *   - holdout usado como discovery     → holdout_used_as_discovery;
 *   - análise no MESMO instante do pré-registro →
 *     holdout_preregistration_same_instant_as_analysis.
 *
 * A data de referência do leakage é `deep_research_at` do candidato (gravada
 * APENAS por `markDeepResearchStarted` do store) — nunca `profiled_at`: o
 * profiling do estágio CANDIDATE ANALYSIS é anterior ao pré-registro por
 * construção e não é pesquisa profunda.
 */

const HOLDOUT_SET_STATES = Object.freeze({
  SELECTED: 'SELECTED',
  HOLDOUT_PREREGISTERED: 'HOLDOUT_PREREGISTERED',
  OPENED_FOR_RESEARCH: 'OPENED_FOR_RESEARCH',
  LEAKAGE_DETECTED: 'LEAKAGE_DETECTED',
});

const LEAKAGE_REASONS = Object.freeze({
  NOT_PREREGISTERED: 'holdout_not_preregistered',
  ANALYZED_BEFORE_PREREGISTRATION: 'holdout_leakage_analyzed_before_preregistration',
  SAME_INSTANT: 'holdout_preregistration_same_instant_as_analysis',
  USED_AS_DISCOVERY: 'holdout_used_as_discovery',
});

function storeError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

const ERROR_CODES = Object.freeze({
  INVALID: 'market_discovery_holdout_invalid',
});

/**
 * Verificação PURA de leakage entre o registro de holdout e o candidato.
 *
 * @param {object} args
 * @param {object} args.holdout   { candidateId, selectedAt, preregistered }
 * @param {object} args.candidate registro do candidato (deep_research_at)
 * @param {Array}  [args.discoverySetKeys] keys do discovery set
 * @returns {{status: 'PASS'|'FAIL', violations: Array}}
 */
function evaluateHoldoutLeakage({ holdout, candidate, discoverySetKeys = [] }) {
  const violations = [];
  if (!holdout || holdout.preregistered !== true || !holdout.selectedAt) {
    violations.push({ reason: LEAKAGE_REASONS.NOT_PREREGISTERED });
    return { status: 'FAIL', violations };
  }

  const candidateKey = String(candidate?.candidateKey || candidate?.candidate_key || '');
  if (discoverySetKeys.includes(candidateKey)) {
    violations.push({ reason: LEAKAGE_REASONS.USED_AS_DISCOVERY, candidateKey });
  }

  const selectedAt = Date.parse(holdout.selectedAt);
  const deepResearchAtValue = candidate?.deep_research_at || candidate?.deepResearchAt || null;
  const deepResearchAt = deepResearchAtValue ? Date.parse(deepResearchAtValue) : null;

  if (Number.isFinite(selectedAt) && Number.isFinite(deepResearchAt)) {
    if (deepResearchAt < selectedAt) {
      violations.push({
        reason: LEAKAGE_REASONS.ANALYZED_BEFORE_PREREGISTRATION,
        selectedAt: holdout.selectedAt,
        deepResearchAt: deepResearchAtValue,
      });
    }
    if (deepResearchAt === selectedAt) {
      violations.push({ reason: LEAKAGE_REASONS.SAME_INSTANT });
    }
  }

  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations };
}

/**
 * @param {object} args
 * @param {object} args.store  marketDiscoveryStore (Postgres ou helper de teste)
 * @param {Function} [args.now]
 */
function createHoldoutPreregistration({ store, now } = {}) {
  if (!store) throw storeError(ERROR_CODES.INVALID, 'store é obrigatório');
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();

  /**
   * PRÉ-REGISTRA o holdout no discovery set. Deve acontecer ANTES de qualquer
   * pesquisa profunda: se o candidato já tem `deep_research_at`, a própria
   * verificação de leakage roda agora e o set vai para LEAKAGE_DETECTED.
   */
  async function preregisterHoldout({ tenantId, setId, candidateKey, selectionBasis }) {
    const set = await store.getDiscoverySet({ tenantId, setId });
    if (!set) throw storeError(ERROR_CODES.INVALID, `discovery set inexistente: ${setId}`);
    if (set.holdout_preregistered === true) {
      // Idempotente: re-pré-registrar o MESMO holdout devolve o estado atual;
      // trocar o holdout depois de aberto seria escolher o resultado.
      if (set.holdout_candidate_id === String(candidateKey)) return set;
      throw storeError(ERROR_CODES.INVALID, `holdout já pré-registrado: ${set.holdout_candidate_id}`);
    }
    if (set.state === HOLDOUT_SET_STATES.OPENED_FOR_RESEARCH) {
      throw storeError(ERROR_CODES.INVALID, 'discovery set já aberto para pesquisa: pré-registro tardio');
    }

    const selectedKeys = Array.isArray(set.selected_candidates) ? set.selected_candidates : [];
    if (selectedKeys.includes(String(candidateKey))) {
      throw storeError(ERROR_CODES.INVALID, `holdout não pode fazer parte do discovery set: ${candidateKey}`);
    }

    const candidate = await store.getCandidate({ tenantId, vertical: set.vertical, candidateKey });
    if (!candidate) throw storeError(ERROR_CODES.INVALID, `candidato fora do universo: ${candidateKey}`);
    if (candidate.state !== 'ACCEPTED') {
      throw storeError(ERROR_CODES.INVALID, `holdout exige candidato ACCEPTED (com evidência): ${candidateKey} (${candidate.state})`);
    }

    const selectedAt = clock();
    const updated = await store.updateDiscoverySet({
      tenantId,
      setId,
      patch: {
        state: HOLDOUT_SET_STATES.HOLDOUT_PREREGISTERED,
        holdoutCandidateId: candidateKey,
        holdoutSelectedAt: selectedAt,
        holdoutSelectionBasis: selectionBasis && typeof selectionBasis === 'object' ? selectionBasis : { reason: String(selectionBasis || '') },
        holdoutPreregistered: true,
      },
    });

    // O pré-registro aconteceu AGORA: se já existe pesquisa profunda sobre o
    // holdout, ela é ANTERIOR ao pré-registro — leakage detectado na hora.
    const leakage = evaluateHoldoutLeakage({
      holdout: { candidateId: candidateKey, selectedAt, preregistered: true },
      candidate,
      discoverySetKeys: selectedKeys,
    });
    if (leakage.status === 'FAIL') {
      await store.updateDiscoverySet({
        tenantId,
        setId,
        patch: { state: HOLDOUT_SET_STATES.LEAKAGE_DETECTED, metadata: { holdoutLeakage: leakage } },
      });
      const error = storeError(ERROR_CODES.INVALID, `leakage no pré-registro do holdout: ${candidateKey}`);
      error.leakage = leakage;
      throw error;
    }

    return updated;
  }

  /**
   * ABRE o discovery set para a pesquisa profunda (handoff). Verifica o
   * leakage ANTES de abrir: leakage → estado LEAKAGE_DETECTED + FAIL.
   * Sem pré-registro → FAIL (holdout_not_preregistered).
   */
  async function openForDeepResearch({ tenantId, setId, deepResearchRunId = null }) {
    const set = await store.getDiscoverySet({ tenantId, setId });
    if (!set) throw storeError(ERROR_CODES.INVALID, `discovery set inexistente: ${setId}`);
    if (set.state === HOLDOUT_SET_STATES.LEAKAGE_DETECTED) {
      const error = storeError(ERROR_CODES.INVALID, `discovery set com leakage detectado: ${setId}`);
      error.leakage = set.metadata?.holdoutLeakage || null;
      throw error;
    }

    const holdout = {
      candidateId: set.holdout_candidate_id,
      selectedAt: set.holdout_selected_at,
      preregistered: set.holdout_preregistered === true,
    };
    const candidate = holdout.candidateId
      ? await store.getCandidate({ tenantId, vertical: set.vertical, candidateKey: holdout.candidateId })
      : null;
    const leakage = evaluateHoldoutLeakage({
      holdout,
      candidate,
      discoverySetKeys: Array.isArray(set.selected_candidates) ? set.selected_candidates : [],
    });
    if (leakage.status === 'FAIL') {
      await store.updateDiscoverySet({
        tenantId,
        setId,
        patch: { state: HOLDOUT_SET_STATES.LEAKAGE_DETECTED, metadata: { holdoutLeakage: leakage } },
      });
      const error = storeError(ERROR_CODES.INVALID, `leakage no holdout: ${setId}`);
      error.leakage = leakage;
      throw error;
    }

    return store.updateDiscoverySet({
      tenantId,
      setId,
      patch: {
        state: HOLDOUT_SET_STATES.OPENED_FOR_RESEARCH,
        openedAt: clock(),
        deepResearchRunId,
      },
    });
  }

  return { preregisterHoldout, openForDeepResearch, evaluateHoldoutLeakage };
}

module.exports = {
  HOLDOUT_SET_STATES,
  LEAKAGE_REASONS,
  ERROR_CODES,
  evaluateHoldoutLeakage,
  createHoldoutPreregistration,
};
