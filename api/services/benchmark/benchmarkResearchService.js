'use strict';

/**
 * Benchmark Research Service — camada de EXECUÇÃO de pesquisa competitiva.
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): `benchmarkSufficiencyEngine` AVALIA
 * uma pesquisa — ele não a executa. O estado real do sample Fitness era
 * `SAMPLE_NOT_RESEARCHED`: 8 benchmarks, ZERO com `analyzedAt`, ZERO
 * `researchVersion`, ZERO `findingsInventory`. Sem uma camada que execute e
 * REGISTRE a pesquisa com evidência, o engine só pode (corretamente) dizer
 * "não mensurável" para sempre.
 *
 * Este serviço é essa camada. Ele é FAIL-CLOSED por construção:
 *
 *  - o DISCOVERY SET é registrado ANTES de qualquer análise (§5) — analisar
 *    antes de registrar a ordem é recusado;
 *  - achado sem fonte verificável NÃO é prova: é registrado como UNVERIFIED e
 *    não conta para novidade, saturação nem certificação (§8, §18);
 *  - fonte genérica (homepage) prova que o fornecedor existe, não que a
 *    capability existe (§15);
 *  - o HOLDOUT não pode ser analisado antes da saturação aparente (§13);
 *  - `analyzedAt` só é gravado com evidência completa de análise (versão de
 *    pesquisa + inventário de findings + mapeamento de arquétipo), espelhando
 *    `HOLDOUT_ANALYSIS_EVIDENCE_FIELDS` do engine.
 *
 * O serviço NÃO decide se a amostra é suficiente: isso continua sendo do
 * engine. Aqui só existem fatos registrados e recusas explícitas.
 */

const {
  isGenericSource,
  classifySourceVerification,
} = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');

/**
 * Política de suficiência versionada — define quais tiers contam como prova.
 * Lida do arquivo canônico (mesmo insumo do gate `validate:benchmark-sufficiency`).
 */
const DEFAULT_POLICY = require('../../../config/benchmark-sufficiency-policy.json');

const FINDING_KINDS = Object.freeze({
  CAPABILITY: 'capability',
  JOURNEY: 'journey',
  BUSINESS_RULE: 'businessRule',
});

const RESEARCH_STATES = Object.freeze({
  NOT_STARTED: 'RESEARCH_NOT_STARTED',
  DISCOVERY_OPEN: 'RESEARCH_DISCOVERY_OPEN',
  IN_PROGRESS: 'RESEARCH_IN_PROGRESS',
  HOLDOUT_BLOCKED: 'RESEARCH_HOLDOUT_BLOCKED',
  COMPLETE: 'RESEARCH_COMPLETE',
});

const RESEARCH_BLOCKERS = Object.freeze({
  NO_DISCOVERY_SET: 'research_discovery_set_not_registered',
  UNKNOWN_BENCHMARK: 'research_unknown_benchmark',
  UNVERIFIED_SOURCE: 'research_source_not_verifiable',
  EVIDENCE_MISSING: 'research_finding_evidence_missing',
  INVALID_KIND: 'research_finding_kind_invalid',
  HOLDOUT_ORDER_VIOLATION: 'research_holdout_analyzed_before_saturation',
  ANALYSIS_INCOMPLETE: 'research_analysis_evidence_incomplete',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeKind(kind) {
  const value = String(kind || '');
  if (value === FINDING_KINDS.CAPABILITY) return FINDING_KINDS.CAPABILITY;
  if (value === FINDING_KINDS.JOURNEY) return FINDING_KINDS.JOURNEY;
  if (value === FINDING_KINDS.BUSINESS_RULE) return FINDING_KINDS.BUSINESS_RULE;
  return null;
}

/**
 * Cria o serviço de pesquisa. Estado em memória por execução de pesquisa —
 * o que vai para o sample do engine é sempre um PATCH explícito
 * (`toSamplePatch()`), nunca um recálculo silencioso.
 *
 * @param {object} [deps]
 * @param {Function} [deps.now] relógio injetável (testes determinísticos)
 */
function createBenchmarkResearchService({ now } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  const runs = new Map();

  function ensureRun(vertical) {
    const key = String(vertical || '');
    if (!key) throw new Error('research_vertical_required');
    if (!runs.has(key)) {
      runs.set(key, {
        vertical: key,
        state: RESEARCH_STATES.NOT_STARTED,
        researchVersion: null,
        discoverySet: [],
        registeredAt: null,
        benchmarks: new Map(),
        holdoutBenchmarkId: null,
        saturationReached: false,
      });
    }
    return runs.get(key);
  }

  /**
   * §5 — o DISCOVERY SET é registrado ANTES da análise. A ordem importa:
   * registrar depois permitiria escolher a ordem que produz o resultado.
   */
  function openDiscoverySet({ vertical, researchVersion, benchmarkIds = [], holdoutBenchmarkId = null }) {
    const run = ensureRun(vertical);
    if (!isNonEmptyString(researchVersion)) throw new Error('research_version_required');
    const ids = benchmarkIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length === 0) throw new Error('research_discovery_set_empty');
    if (new Set(ids).size !== ids.length) throw new Error('research_discovery_set_duplicate');

    run.researchVersion = researchVersion;
    run.discoverySet = ids;
    run.registeredAt = clock();
    run.holdoutBenchmarkId = holdoutBenchmarkId ? String(holdoutBenchmarkId) : null;
    run.state = RESEARCH_STATES.DISCOVERY_OPEN;
    for (const id of ids) {
      if (!run.benchmarks.has(id)) {
        run.benchmarks.set(id, {
          id,
          analyzedAt: null,
          findings: [],
          verifiedFindings: 0,
          unverifiedFindings: 0,
          marketArchetypeMapping: null,
        });
      }
    }
    return { vertical: run.vertical, discoverySet: [...run.discoverySet], registeredAt: run.registeredAt };
  }

  function assertDiscoveryOpen(run) {
    if (run.state === RESEARCH_STATES.NOT_STARTED) {
      const error = new Error(RESEARCH_BLOCKERS.NO_DISCOVERY_SET);
      error.code = RESEARCH_BLOCKERS.NO_DISCOVERY_SET;
      throw error;
    }
  }

  /**
   * Registra um achado. Um achado sem fonte verificável é registrado como
   * UNVERIFIED e NÃO conta para novidade/saturação/certificação.
   *
   * @param {object} args
   * @param {string} args.vertical
   * @param {string} args.benchmarkId
   * @param {string} args.kind            capability | journey | businessRule
   * @param {string} args.externalName    nome no produto externo
   * @param {string} [args.canonicalId]   capability/jornada/regra canônica
   * @param {object} args.source          `{ url, tier, specificity? }`
   * @param {string} [args.evidenceRef]   referência da evidência capturada
   * @param {string} [args.classification] CRITICAL | REQUIRED | OPTIONAL
   * @param {string} [args.archetype]
   */
  function recordFinding({
    vertical,
    benchmarkId,
    kind,
    externalName,
    canonicalId = null,
    source,
    evidenceRef = null,
    classification = null,
    archetype = null,
  }) {
    const run = ensureRun(vertical);
    assertDiscoveryOpen(run);

    const id = String(benchmarkId || '');
    const entry = run.benchmarks.get(id);
    if (!entry) {
      const error = new Error(`${RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK}: ${id}`);
      error.code = RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK;
      throw error;
    }

    const normalizedKind = normalizeKind(kind);
    if (!normalizedKind) {
      const error = new Error(`${RESEARCH_BLOCKERS.INVALID_KIND}: ${kind}`);
      error.code = RESEARCH_BLOCKERS.INVALID_KIND;
      throw error;
    }

    const sourceVerification = classifyResearchSource(source);
    const verified = sourceVerification.verified && isNonEmptyString(evidenceRef);

    const finding = {
      benchmarkId: id,
      kind: normalizedKind,
      externalName: String(externalName || '').trim() || null,
      canonicalId: canonicalId ? String(canonicalId) : null,
      source: source ? { url: source.url || null, tier: source.tier ?? null, specificity: source.specificity || null } : null,
      evidenceRef: evidenceRef || null,
      classification,
      archetype,
      verified,
      verificationState: sourceVerification.state,
      recordedAt: clock(),
    };

    entry.findings.push(finding);
    if (verified) entry.verifiedFindings += 1;
    else entry.unverifiedFindings += 1;

    run.state = RESEARCH_STATES.IN_PROGRESS;
    return finding;
  }

  /**
   * §13 — o HOLDOUT não pode ser analisado antes da saturação aparente.
   * Analisá-lo cedo destrói a única medição de generalização que existe.
   */
  function assertHoldoutNotAnalyzedEarly(run, benchmarkId) {
    if (!run.holdoutBenchmarkId) return;
    if (String(benchmarkId) !== run.holdoutBenchmarkId) return;
    if (run.saturationReached) return;
    const error = new Error(`${RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION}: ${benchmarkId}`);
    error.code = RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION;
    throw error;
  }

  /** Marca que a saturação APARENTE foi atingida (habilita abrir o holdout). */
  function markApparentSaturation(vertical) {
    const run = ensureRun(vertical);
    run.saturationReached = true;
    return { vertical: run.vertical, saturationReached: true };
  }

  /**
   * Marca um benchmark como ANALISADO. Só é permitido com evidência completa:
   *   - pelo menos 1 achado VERIFICADO;
   *   - mapeamento de arquétipo;
   *   - a ordem de discovery registrada.
   *
   * Sem isso o benchmark permanece sem `analyzedAt` — e o engine, corretamente,
   * o trata como NOT_MEASURABLE em vez de "zero novidade".
   */
  function markAnalyzed({ vertical, benchmarkId, marketArchetypeMapping = null, analyzedAt = null }) {
    const run = ensureRun(vertical);
    assertDiscoveryOpen(run);
    const id = String(benchmarkId || '');
    const entry = run.benchmarks.get(id);
    if (!entry) {
      const error = new Error(`${RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK}: ${id}`);
      error.code = RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK;
      throw error;
    }
    assertHoldoutNotAnalyzedEarly(run, id);

    const missing = [];
    if (entry.verifiedFindings === 0) missing.push('verifiedFindings');
    if (!marketArchetypeMapping || !isNonEmptyString(marketArchetypeMapping.archetype)) missing.push('marketArchetypeMapping');

    if (missing.length > 0) {
      const error = new Error(`${RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE}: ${id} (${missing.join(',')})`);
      error.code = RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE;
      error.missing = missing;
      throw error;
    }

    entry.analyzedAt = analyzedAt || clock();
    entry.marketArchetypeMapping = {
      archetype: String(marketArchetypeMapping.archetype),
      rationale: marketArchetypeMapping.rationale || null,
    };
    entry.findingsInventory = {
      total: entry.findings.length,
      verified: entry.verifiedFindings,
      unverified: entry.unverifiedFindings,
    };
    return { ...entry };
  }

  /**
   * Snapshot do estado da pesquisa para UMA vertical, no vocabulário
   * consumido pelo engine (`HOLDOUT_ANALYSIS_EVIDENCE_FIELDS`).
   */
  function summarize(vertical) {
    const run = ensureRun(vertical);
    const analysed = [...run.benchmarks.values()].filter((b) => isNonEmptyString(b.analyzedAt));
    const unanalysed = [...run.benchmarks.values()].filter((b) => !isNonEmptyString(b.analyzedAt));
    const totalFindings = [...run.benchmarks.values()].reduce((acc, b) => acc + b.findings.length, 0);
    const unverifiedFindings = [...run.benchmarks.values()].reduce((acc, b) => acc + b.unverifiedFindings, 0);

    return {
      vertical: run.vertical,
      state: run.state,
      researchVersion: run.researchVersion,
      discoverySet: [...run.discoverySet],
      holdoutBenchmarkId: run.holdoutBenchmarkId,
      saturationReached: run.saturationReached,
      analysedBenchmarks: analysed.length,
      unanalysedBenchmarks: unanalysed.map((b) => b.id),
      totalFindings,
      unverifiedFindings,
      requiresRevalidation: unverifiedFindings > 0,
      benchmarks: [...run.benchmarks.values()].map((b) => ({
        id: b.id,
        analyzedAt: b.analyzedAt,
        verifiedFindings: b.verifiedFindings,
        unverifiedFindings: b.unverifiedFindings,
        findingsInventory: b.findingsInventory || null,
        marketArchetypeMapping: b.marketArchetypeMapping,
      })),
    };
  }

  /**
   * PATCH para o sample do engine — apenas campos de PESQUISA. O inventário
   * canônico, baselines e criticalidade NÃO são tocados por aqui.
   */
  function toSamplePatch(vertical) {
    const run = ensureRun(vertical);
    return {
      researchVersion: run.researchVersion,
      benchmarks: [...run.benchmarks.values()].map((b) => ({
        id: b.id,
        analyzedAt: b.analyzedAt,
        researchVersion: b.analyzedAt ? run.researchVersion : null,
        findingsInventory: b.findingsInventory || null,
        marketArchetypeMapping: b.marketArchetypeMapping,
      })),
    };
  }

  return {
    openDiscoverySet,
    recordFinding,
    markAnalyzed,
    markApparentSaturation,
    summarize,
    toSamplePatch,
    getRun: (vertical) => (runs.has(String(vertical)) ? summarize(vertical) : null),
  };
}

/**
 * Verifica uma fonte de pesquisa. Delega a classificação ao engine — fonte
 * genérica (homepage) não prova capability e obtenção não confirmada
 * (`verified !== true`) é NEEDS_VERIFICATION, não prova.
 *
 * @param {object} source `{ url, tier, specificity?, verified?, httpStatus? }`
 * @param {object} [policy] política de suficiência (tiers oficiais/secundários)
 * @returns {{verified: boolean, state: string, reason: string|null}}
 */
function classifyResearchSource(source, policy = DEFAULT_POLICY) {
  if (!source || !isNonEmptyString(source.url)) {
    return { verified: false, state: 'UNVERIFIED', reason: 'source_url_required' };
  }
  if (isGenericSource(source)) {
    return { verified: false, state: 'UNVERIFIED', reason: 'generic_source_cannot_prove_capability' };
  }
  const state = classifySourceVerification(source, policy);
  const verified = state === 'VERIFIED_OFFICIAL' || state === 'VERIFIED_SECONDARY';
  return {
    verified,
    state,
    reason: verified ? null : (state === 'NEEDS_VERIFICATION' ? 'source_retrieval_not_confirmed' : 'source_not_verifiable'),
  };
}

module.exports = {
  FINDING_KINDS,
  RESEARCH_STATES,
  RESEARCH_BLOCKERS,
  DEFAULT_POLICY,
  classifyResearchSource,
  createBenchmarkResearchService,
};
