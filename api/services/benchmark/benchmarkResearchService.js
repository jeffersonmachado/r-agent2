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
 * GAP CONFIRMADO (auditoria 2026-09-13): a camada de execução mantinha
 * `runs = new Map()`. Um run "iniciado" desaparecia no restart do processo,
 * nenhum achado era auditável depois e `toSamplePatch()` não tinha consumidor
 * real — foi assim que um patch com `findingsInventory` em formato que o engine
 * REJEITA (objeto de contadores em vez de array de referências) passou
 * desapercebido por completo.
 *
 * AGORA:
 *   - `store` é OBRIGATÓRIO (Postgres em produção). Sem store a operação falha
 *     com `persistence_required` — nunca existe fallback em memória aqui;
 *   - este módulo é POLÍTICA (fail-closed), o store é ESTADO;
 *   - `buildSamplePatch()` substitui `toSamplePatch()`: produz um patch no
 *     formato EXATO do engine (array de referências, fontes com id, evidência
 *     declarada, `inventoryVersion` por benchmark) e é consumido de verdade
 *     pelo supervisor / registro do sample — não é código morto.
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

const {
  RESEARCH_AXES,
  AXIS_STATES,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  axisForKind,
  isSubjectNameFinding,
  normalizeFindingName,
  resolveFindingOrigin,
  buildAxisCompleteness,
  evaluateAnalyzedCriterion,
} = require('./benchmarkResearchSemantics');

const { SEMANTIC_STATUS } = require('./semantic/semanticExtractor');

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
  INSPECTION_HASH_REQUIRED: 'benchmark_source_inspection_hash_required',
  PERSISTENCE_REQUIRED: 'persistence_required',
});

/**
 * kind do finding → campos de novidade por dimensão no sample do engine.
 * A semântica é do próprio engine: `new*` é o NUMERADOR da taxa de novidade;
 * `newRequired*`/`newCritical*` são contagens ABSOLUTAS com limiar 0. Um item
 * novo porém REQUIRED/CRITICAL entra nos dois lugares — ele é novo E tem
 * severidade, e omiti-lo do numerador reduziria a taxa artificialmente.
 */
const NOVELTY_FIELDS = Object.freeze({
  [FINDING_KINDS.CAPABILITY]: { new: 'newCapabilities', required: 'newRequiredCapabilities', critical: 'newCriticalCapabilities' },
  [FINDING_KINDS.JOURNEY]: { new: 'newJourneys', required: 'newRequiredJourneys', critical: 'newCriticalJourneys' },
  [FINDING_KINDS.BUSINESS_RULE]: { new: 'newBusinessRules', required: 'newRequiredBusinessRules', critical: 'newCriticalBusinessRules' },
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

/** ISO-8601 ou null. Datas inválidas NUNCA viram `new Date()` silencioso. */
function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Vocabulário de novidade do engine, vazio — nunca `undefined`. */
function emptyNovelty() {
  return {
    newCapabilities: [],
    newRequiredCapabilities: [],
    newCriticalCapabilities: [],
    newJourneys: [],
    newRequiredJourneys: [],
    newCriticalJourneys: [],
    newBusinessRules: [],
    newRequiredBusinessRules: [],
    newCriticalBusinessRules: [],
  };
}

/** Erro com `code` estável (os consumidores decidem por código, não por texto). */
function blocker(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

/**
 * Cria o serviço de pesquisa. O `store` é a AUTORIDADE do estado (§B4):
 * sem ele não há serviço — `persistence_required`.
 *
 * @param {object} deps
 * @param {object} deps.store  store persistente (Postgres) — obrigatório
 * @param {Function} [deps.now] relógio injetável (testes determinísticos)
 */
function createBenchmarkResearchService({ store, now } = {}) {
  if (!store) {
    throw blocker(RESEARCH_BLOCKERS.PERSISTENCE_REQUIRED, 'store persistente é obrigatório');
  }
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();

  function requireTenant(tenantId) {
    if (!isNonEmptyString(tenantId)) {
      throw blocker(RESEARCH_BLOCKERS.PERSISTENCE_REQUIRED, 'tenantId é obrigatório');
    }
    return String(tenantId);
  }

  /** Carrega o run do store. Sem discovery set registrado, a operação é recusada. */
  async function loadRun(tenantId, vertical) {
    const run = await store.getRun({ tenantId: requireTenant(tenantId), vertical });
    if (!run) throw blocker(RESEARCH_BLOCKERS.NO_DISCOVERY_SET, String(vertical));
    return run;
  }

  /**
   * Normaliza a LINEAGE de um discovery set produzido pela descoberta
   * autônoma de mercado (T-MR2). A proveniência é persistida no metadata do
   * run — sem ela, a cadeia mercado → benchmark não seria auditável.
   * Lineage declarada SEM o run de origem é recusada: proveniência incompleta
   * não é lineage.
   */
  function normalizeLineage(lineage) {
    if (lineage === null || lineage === undefined) return null;
    const runId = String(lineage?.marketDiscoveryRunId ?? '').trim();
    if (!runId) {
      const error = new Error('market_discovery_lineage_invalid: marketDiscoveryRunId é obrigatório na lineage');
      error.code = 'market_discovery_lineage_invalid';
      throw error;
    }
    return {
      source: String(lineage.source || 'market-discovery'),
      marketDiscoveryRunId: runId,
      discoverySetId: isNonEmptyString(lineage.discoverySetId) ? String(lineage.discoverySetId) : null,
      holdoutPreregisteredAt: isNonEmptyString(lineage.holdoutPreregisteredAt) ? String(lineage.holdoutPreregisteredAt) : null,
    };
  }

  /**
   * §5 — o DISCOVERY SET é registrado ANTES da análise. A ordem importa:
   * registrar depois permitiria escolher a ordem que produz o resultado.
   *
   * @param {object} [args.lineage] proveniência do discovery set quando ele
   *   vem de um run de market discovery (`marketDiscoveryRunId` obrigatório);
   *   persistida em `metadata.lineage` do run.
   */
  async function openDiscoverySet({ tenantId, vertical, researchVersion, benchmarkIds = [], holdoutBenchmarkId = null, lineage = null }) {
    if (!isNonEmptyString(researchVersion)) throw new Error('research_version_required');
    // Validação de POLÍTICA antes do store: a mensagem é do domínio, não do
    // driver de persistência.
    const ids = (Array.isArray(benchmarkIds) ? benchmarkIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean);
    if (ids.length === 0) throw new Error('research_discovery_set_empty');
    if (new Set(ids).size !== ids.length) throw new Error('research_discovery_set_duplicate');
    if (!isNonEmptyString(vertical)) throw new Error('research_vertical_required');
    const normalizedLineage = normalizeLineage(lineage);
    const run = await store.openRun({
      tenantId: requireTenant(tenantId),
      vertical,
      researchVersion,
      benchmarkIds: ids,
      holdoutBenchmarkId,
      registeredAt: clock(),
      metadata: normalizedLineage ? { lineage: normalizedLineage } : {},
    });
    return summarizeFrom(run);
  }

  /**
   * Registra um achado. Um achado sem fonte verificável (ou sem evidência
   * capturada) é persistido como UNVERIFIED e NÃO conta para
   * novidade/saturação/certificação.
   *
   * A cadeia finding → evidence → source é gravada em LINHAS próprias: uma
   * afirmação sem linha de evidência não é prova, é texto.
   *
   * @param {object} args
   * @param {string} args.tenantId
   * @param {string} args.vertical
   * @param {string} args.benchmarkId
   * @param {string} args.kind            capability | journey | businessRule
   * @param {string} args.externalName    nome no produto externo
   * @param {string} [args.canonicalId]   capability/jornada/regra canônica
   * @param {object} args.source          `{ url, tier, specificity?, httpStatus? }`
   * @param {string} [args.evidenceRef]   referência da evidência capturada
   * @param {string} [args.classification] CRITICAL | REQUIRED | OPTIONAL
   * @param {string} [args.archetype]
   */
  async function recordFinding({
    tenantId,
    vertical,
    benchmarkId,
    kind,
    externalName,
    canonicalId = null,
    source,
    evidenceRef = null,
    classification = null,
    archetype = null,
    origin = null,
    locator = null,
    normalizedId = null,
    analyzedContentHash = null,
    benchmark = null,
    metadata = {},
  }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);

    const id = String(benchmarkId || '');
    const subject = await store.getSubject({ tenantId: tenant, runId: run.id, benchmarkId: id });
    if (!subject) throw blocker(RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK, id);

    const normalizedKind = normalizeKind(kind);
    if (!normalizedKind) throw blocker(RESEARCH_BLOCKERS.INVALID_KIND, String(kind));

    // §TAREFA 02/03/78 — o fornecedor é o SUJEITO da pesquisa, não um achado.
    // Um achado chamado "EVO" entraria na curva de novidade como se fosse
    // capacidade que a plataforma não tem. A recusa é por CÓDIGO, para o
    // chamador poder reportar nominalmente o que foi rejeitado.
    if (isSubjectNameFinding({ candidate: externalName, benchmark: benchmark || { id } })) {
      throw blocker(SEMANTIC_CODES.SUBJECT_AS_CAPABILITY, `${externalName} (${id})`);
    }

    const sourceVerification = classifyResearchSource(source);
    const contentHash = isNonEmptyString(source?.contentHash) ? String(source.contentHash) : null;

    // §TAREFA 11/12/82 — binding criptográfico: a evidência só vale se o hash
    // do conteúdo ANALISADO for o mesmo do conteúdo CAPTURADO. Um fetch da
    // versão A com evidência da versão B é uma prova de outro documento.
    if (analyzedContentHash && contentHash && String(analyzedContentHash) !== String(contentHash)) {
      throw blocker(SEMANTIC_CODES.EVIDENCE_HASH_MISMATCH, `${id}: analyzed=${analyzedContentHash} evidence=${contentHash}`);
    }
    const boundContentHash = analyzedContentHash || contentHash;

    const verified = sourceVerification.verified && isNonEmptyString(evidenceRef);

    const sourceRow = isNonEmptyString(source?.url)
      ? await store.upsertSource({
        tenantId: tenant,
        runId: run.id,
        benchmarkId: id,
        source: {
          url: source.url,
          tier: source.tier ?? null,
          specificity: source.specificity || null,
          httpStatus: source.httpStatus ?? null,
          verified: sourceVerification.verified,
          verificationState: sourceVerification.state,
        },
      })
      : null;

    // Evidência só existe se FOI capturada. Sem referência não há linha — e sem
    // linha não há como um achado ser verificado.
    const evidenceRow = verified
      ? await store.appendEvidence({
        tenantId: tenant,
        runId: run.id,
        benchmarkId: id,
        sourceId: sourceRow ? sourceRow.id : null,
        evidenceRef: String(evidenceRef),
        contentHash: boundContentHash,
        httpStatus: source?.httpStatus ?? null,
        capturedAt: clock(),
        metadata: {
          locator: locator || null,
          normalizedId: normalizedId || null,
        },
      })
      : null;

    const findingRow = await store.insertFinding({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: id,
      kind: normalizedKind,
      externalName: String(externalName || '').trim() || null,
      canonicalId: canonicalId ? String(canonicalId) : null,
      classification: classification ? String(classification) : null,
      archetype: archetype ? String(archetype) : null,
      verified,
      verificationState: sourceVerification.state,
      sourceId: sourceRow ? sourceRow.id : null,
      evidenceId: evidenceRow ? evidenceRow.id : null,
      recordedAt: clock(),
      metadata: {
        ...metadata,
        // §TAREFA 18 — proveniência: EXTERNAL_OBSERVED exige locator na fonte.
        origin: resolveFindingOrigin({ locator, origin }),
        locator: locator || null,
        normalizedId: normalizedId || null,
        contentHash: boundContentHash,
        axis: axisForKind(normalizedKind),
      },
    });

    if (run.state !== RESEARCH_STATES.IN_PROGRESS && run.state !== RESEARCH_STATES.COMPLETE) {
      await store.updateRunState({ tenantId: tenant, runId: run.id, state: RESEARCH_STATES.IN_PROGRESS });
    }

    return toFinding(findingRow, sourceRow, evidenceRow, sourceVerification);
  }

  /**
   * §13 — o HOLDOUT não pode ser analisado antes da saturação aparente.
   * Analisá-lo cedo destrói a única medição de generalização que existe.
   */
  function assertHoldoutNotAnalyzedEarly(run, benchmarkId) {
    if (!run.holdout_benchmark_id) return;
    if (String(benchmarkId) !== String(run.holdout_benchmark_id)) return;
    if (run.saturation_reached) return;
    throw blocker(RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION, String(benchmarkId));
  }

  /**
   * Persiste o estado de pesquisa de UM eixo (`CAPABILITY_AXIS`, `JOURNEY_AXIS`,
   * `BUSINESS_RULE_AXIS`). É este estado — não a existência de um achado — que
   * decide se o eixo conta como pesquisado (TAREFA 19/21/22).
   */
  async function setAxisState({ tenantId, vertical, benchmarkId, axis, state, reason = null }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);
    const id = String(benchmarkId || '');
    if (!Object.values(RESEARCH_AXES).includes(String(axis))) {
      throw blocker(RESEARCH_BLOCKERS.INVALID_KIND, String(axis));
    }
    if (!Object.values(AXIS_STATES).includes(String(state))) {
      throw blocker(RESEARCH_BLOCKERS.INVALID_KIND, String(state));
    }
    const row = await store.updateSubjectResearchState({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: id,
      patch: { axes: { [axis]: String(state) }, metadata: { axisReason: reason } },
    });
    return toBenchmarkSummary(row, []);
  }

  /**
   * Registra quais inspeções foram EXECUTADAS (prova, não intenção) e, quando
   * informado, metadados do sujeito (nome/aliases do benchmark, erros abertos).
   * Ambos ficam PERSISTIDOS — o critério de análise é auditado depois.
   */
  async function recordInspections({ tenantId, vertical, benchmarkId, inspections = {}, metadata = null }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);
    return store.updateSubjectResearchState({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: String(benchmarkId || ''),
      patch: { inspections, ...(metadata ? { metadata } : {}) },
    });
  }

  /**
   * Persiste a proveniência de INSPEÇÃO de UMA fonte (T-B2) — INDEPENDENTE de
   * haver achado. Antes desta operação, uma fonte buscada + inspecionada com
   * zero achados não deixava rastro: sem contentHash/retrievedAt/inspectedAt/
   * documentType/estado por eixo persistidos, "pesquisei e não achei nada" era
   * indistinguível de "não pesquisei" depois do restart.
   *
   * Hash binding (fail-closed):
   *   - `analyzedContentHash` ≠ hash da fonte → INSPECTION_HASH_MISMATCH;
   *   - mesma `evidenceRef` já capturada com OUTRO hash → EVIDENCE_HASH_MISMATCH;
   *   - nenhum hash disponível → benchmark_source_inspection_hash_required.
   *
   * Idempotente por `(fonte, contentHash)` (o store garante): re-inspeção do
   * mesmo conteúdo é UPSERT; conteúdo novo é nova linha.
   */
  async function recordSourceInspection({
    tenantId,
    vertical,
    benchmarkId,
    source,
    evidenceRef = null,
    contentHash = null,
    analyzedContentHash = null,
    retrievedAt = null,
    inspectedAt = null,
    documentType = null,
    provider = null,
    documentationStatus = null,
    apiStatus = null,
    axisStatuses = {},
    errors = [],
    metadata = {},
  }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);
    const id = String(benchmarkId || '');
    const subject = await store.getSubject({ tenantId: tenant, runId: run.id, benchmarkId: id });
    if (!subject) throw blocker(RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK, id);

    const sourceHash = isNonEmptyString(source?.contentHash) ? String(source.contentHash) : null;
    if (analyzedContentHash && sourceHash && String(analyzedContentHash) !== sourceHash) {
      throw blocker(
        SEMANTIC_CODES.INSPECTION_HASH_MISMATCH,
        `${id}: analyzed=${analyzedContentHash} source=${sourceHash}`,
      );
    }
    const boundHash = isNonEmptyString(analyzedContentHash) ? String(analyzedContentHash)
      : (isNonEmptyString(contentHash) ? String(contentHash) : sourceHash);
    if (!isNonEmptyString(boundHash)) {
      throw blocker(RESEARCH_BLOCKERS.INSPECTION_HASH_REQUIRED, id);
    }

    // A MESMA referência de evidência com hash diferente é prova de OUTRO
    // documento — recusada antes de qualquer escrita.
    if (isNonEmptyString(evidenceRef)) {
      const existing = (await store.listEvidence({ tenantId: tenant, runId: run.id, benchmarkId: id }))
        .find((row) => row.evidence_ref === String(evidenceRef));
      if (existing && isNonEmptyString(existing.content_hash) && String(existing.content_hash) !== boundHash) {
        throw blocker(
          SEMANTIC_CODES.EVIDENCE_HASH_MISMATCH,
          `${id}: evidence=${existing.content_hash} inspection=${boundHash}`,
        );
      }
    }

    const sourceVerification = classifyResearchSource(source);
    const sourceRow = isNonEmptyString(source?.url)
      ? await store.upsertSource({
        tenantId: tenant,
        runId: run.id,
        benchmarkId: id,
        source: {
          url: source.url,
          tier: source.tier ?? null,
          specificity: source.specificity || null,
          httpStatus: source.httpStatus ?? null,
          verified: sourceVerification.verified,
          verificationState: sourceVerification.state,
        },
      })
      : null;

    // A evidência capturada de uma fonte inspecionada vale MESMO sem achado:
    // é ela que sustenta o critério de análise com zero findings (T-B1).
    const evidenceRow = sourceVerification.verified && isNonEmptyString(evidenceRef)
      ? await store.appendEvidence({
        tenantId: tenant,
        runId: run.id,
        benchmarkId: id,
        sourceId: sourceRow ? sourceRow.id : null,
        evidenceRef: String(evidenceRef),
        contentHash: boundHash,
        httpStatus: source?.httpStatus ?? null,
        capturedAt: clock(),
        metadata: { locator: metadata.locator || `document:${source.url}` },
      })
      : null;

    const row = await store.upsertSourceInspection({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: id,
      subjectId: subject.id,
      sourceId: sourceRow ? sourceRow.id : null,
      url: source?.url,
      contentHash: boundHash,
      retrievedAt: retrievedAt || clock(),
      inspectedAt: inspectedAt || clock(),
      documentType: documentType || source?.contentType || null,
      provider,
      documentationStatus: documentationStatus || 'INSPECTED',
      apiStatus: apiStatus || 'INSPECTED',
      axisStatuses,
      errors,
      metadata: { ...metadata, evidenceId: evidenceRow ? evidenceRow.id : null },
    });

    if (run.state !== RESEARCH_STATES.IN_PROGRESS && run.state !== RESEARCH_STATES.COMPLETE) {
      await store.updateRunState({ tenantId: tenant, runId: run.id, state: RESEARCH_STATES.IN_PROGRESS });
    }

    return {
      id: row.id,
      benchmarkId: row.benchmark_id,
      sourceId: row.source_id,
      url: row.url,
      contentHash: row.content_hash,
      retrievedAt: toIso(row.retrieved_at),
      inspectedAt: toIso(row.inspected_at),
      documentType: row.document_type,
      provider: row.provider,
      documentationStatus: row.documentation_status,
      apiStatus: row.api_status,
      evidenceId: evidenceRow ? evidenceRow.id : null,
      verified: sourceVerification.verified,
      verificationState: sourceVerification.state,
    };
  }

  /** Marca que a saturação APARENTE foi atingida (habilita abrir o holdout). */
  async function markApparentSaturation({ tenantId, vertical }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);
    await store.updateRunState({ tenantId: tenant, runId: run.id, saturationReached: true });
    return { vertical: run.vertical, saturationReached: true };
  }

  /**
   * Marca um benchmark como ANALISADO.
   *
   * §TAREFA 20/25/80 — o critério ANTIGO ("1 achado verificado + mapeamento de
   * arquétipo") transformava "achei uma página" em ANALYZED, e ANALYZED é a
   * evidência que o engine usa para dizer que o mercado foi coberto. O critério
   * agora exige: discovery de fonte, inspeção de DOCUMENTAÇÃO, inspeção de API
   * (quando aplicável), os TRÊS eixos pesquisados, evidência com hash binding e
   * nenhum erro crítico em aberto — tudo lido do estado PERSISTIDO.
   */
  async function markAnalyzed({ tenantId, vertical, benchmarkId, marketArchetypeMapping = null, analyzedAt = null, inspections = null }) {
    const tenant = requireTenant(tenantId);
    const run = await loadRun(tenant, vertical);
    const id = String(benchmarkId || '');
    const subject = await store.getSubject({ tenantId: tenant, runId: run.id, benchmarkId: id });
    if (!subject) throw blocker(RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK, id);
    assertHoldoutNotAnalyzedEarly(run, id);

    const [findings, evidence, sources, sourceInspections] = await Promise.all([
      store.listFindings({ tenantId: tenant, runId: run.id, benchmarkId: id }),
      store.listEvidence({ tenantId: tenant, runId: run.id, benchmarkId: id }),
      store.listSources({ tenantId: tenant, runId: run.id, benchmarkId: id }),
      store.listSourceInspections({ tenantId: tenant, runId: run.id, benchmarkId: id }),
    ]);
    const verifiedFindings = findings.filter((finding) => finding.verified === true);

    const subjectMetadata = subject.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
    const persistedAxes = subjectMetadata.researchAxes || {};
    const persistedInspections = { ...(subjectMetadata.inspections || {}), ...(inspections || {}) };

    // T-B2 — a inspeção persistida por fonte também é evidência de análise:
    // sem ela, uma fonte inspecionada com ZERO achados não sustentaria o
    // critério. Só contam inspeções EFETIVAMENTE executadas e com hash ligado.
    const inspectionEvidence = sourceInspections
      .filter((row) => (row.documentation_status === 'INSPECTED' || row.api_status === 'INSPECTED')
        && isNonEmptyString(row.content_hash))
      .map((row) => ({
        verified: true,
        contentHash: row.content_hash,
        locator: (row.metadata && row.metadata.locator) || `document:${row.url}`,
      }));

    const criterion = evaluateAnalyzedCriterion({
      benchmark: { id, ...(subjectMetadata.benchmark || {}) },
      inspections: persistedInspections,
      axes: persistedAxes,
      findings,
      evidence: [
        ...evidence.map((row) => ({
          verified: true,
          contentHash: row.content_hash,
          locator: (row.metadata && row.metadata.locator) || null,
        })),
        ...inspectionEvidence,
      ],
      errors: Array.isArray(subjectMetadata.errors) ? subjectMetadata.errors : [],
      sourceDiscovery: sources.length > 0,
    });

    const missing = [...criterion.missing];
    if (!marketArchetypeMapping || !isNonEmptyString(marketArchetypeMapping.archetype)) missing.push('marketArchetypeMapping');

    if (missing.length > 0) {
      throw blocker(RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE, `${id} (${missing.join(',')})`);
    }

    const row = await store.markSubjectAnalyzed({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: id,
      analyzedAt: analyzedAt || clock(),
      researchVersion: run.research_version,
      // Array de REFERÊNCIAS: é este o formato que PROVA análise (§5 do engine).
      findingsInventory: verifiedFindings.map((finding) => finding.id),
      marketArchetypeMapping: {
        archetype: String(marketArchetypeMapping.archetype),
        rationale: marketArchetypeMapping.rationale || null,
      },
    });

    // A completude registrada faz parte do critério: fica GRAVADA, não apenas
    // calculada (TAREFA 20 — 'research completeness recorded').
    await store.updateSubjectResearchState({
      tenantId: tenant,
      runId: run.id,
      benchmarkId: id,
      patch: {
        extraction: {
          analyzedCriterion: { satisfied: true, missing: [], detail: criterion.detail },
        },
      },
    });

    const subjects = await store.listSubjects({ tenantId: tenant, runId: run.id });
    const allAnalyzed = subjects.length > 0 && subjects.every((item) => isNonEmptyString(toIso(item.analyzed_at)));
    if (allAnalyzed && run.state !== RESEARCH_STATES.COMPLETE) {
      await store.updateRunState({ tenantId: tenant, runId: run.id, state: RESEARCH_STATES.COMPLETE });
    }

    return toBenchmarkSummary(row, findings);
  }

  function toBenchmarkSummary(subject, findings = []) {
    const own = findings.filter((finding) => finding.benchmark_id === subject.benchmark_id);
    const verified = own.filter((finding) => finding.verified === true);
    return {
      id: subject.benchmark_id,
      discoveryOrder: subject.discovery_order,
      analyzedAt: toIso(subject.analyzed_at),
      researchVersion: subject.research_version || null,
      verifiedFindings: verified.length,
      unverifiedFindings: own.length - verified.length,
      findingsInventory: Array.isArray(subject.findings_inventory) ? [...subject.findings_inventory] : null,
      marketArchetypeMapping: subject.market_archetype_mapping || null,
    };
  }

  function summarizeFrom(run, subjects = [], findings = [], sources = []) {
    if (!run) {
      return {
        vertical: null,
        state: RESEARCH_STATES.NOT_STARTED,
        researchVersion: null,
        discoverySet: [],
        holdoutBenchmarkId: null,
        saturationReached: false,
        analysedBenchmarks: 0,
        unanalysedBenchmarks: [],
        totalFindings: 0,
        unverifiedFindings: 0,
        requiresRevalidation: false,
        sources: 0,
        benchmarks: [],
      };
    }

    const analysed = subjects.filter((subject) => isNonEmptyString(toIso(subject.analyzed_at)));
    const unanalysed = subjects.filter((subject) => !isNonEmptyString(toIso(subject.analyzed_at)));
    const unverifiedFindings = findings.filter((finding) => finding.verified !== true).length;

    return {
      vertical: run.vertical,
      state: run.state,
      researchVersion: run.research_version,
      discoverySet: Array.isArray(run.discovery_set) ? [...run.discovery_set] : [],
      holdoutBenchmarkId: run.holdout_benchmark_id || null,
      saturationReached: run.saturation_reached === true,
      analysedBenchmarks: analysed.length,
      unanalysedBenchmarks: unanalysed.map((subject) => subject.benchmark_id),
      totalFindings: findings.length,
      unverifiedFindings,
      requiresRevalidation: unverifiedFindings > 0,
      sources: sources.length,
      benchmarks: subjects.map((subject) => toBenchmarkSummary(subject, findings)),
    };
  }

  /** Snapshot do estado da pesquisa — SEMPRE lido do store (nunca de memória). */
  async function summarize({ tenantId, vertical }) {
    const tenant = requireTenant(tenantId);
    const run = await store.getRun({ tenantId: tenant, vertical });
    if (!run) return summarizeFrom(null);
    const [subjects, findings, sources] = await Promise.all([
      store.listSubjects({ tenantId: tenant, runId: run.id }),
      store.listFindings({ tenantId: tenant, runId: run.id }),
      store.listSources({ tenantId: tenant, runId: run.id }),
    ]);
    return summarizeFrom(run, subjects, findings, sources);
  }

  function toFinding(findingRow, sourceRow, evidenceRow, sourceVerification) {
    return {
      id: findingRow.id,
      benchmarkId: findingRow.benchmark_id,
      kind: findingRow.kind,
      externalName: findingRow.external_name,
      canonicalId: findingRow.canonical_id,
      classification: findingRow.classification,
      archetype: findingRow.archetype,
      source: sourceRow
        ? { id: sourceRow.id, url: sourceRow.url, tier: sourceRow.tier, specificity: sourceRow.specificity }
        : null,
      evidenceRef: evidenceRow ? evidenceRow.evidence_ref : null,
      evidenceId: evidenceRow ? evidenceRow.id : null,
      verified: findingRow.verified === true,
      verificationState: sourceVerification.state,
      verificationReason: sourceVerification.reason,
      recordedAt: toIso(findingRow.recorded_at),
    };
  }

  /**
   * Normaliza os achados VERIFICADOS de um benchmark no vocabulário de novidade
   * do engine. Somente itens verificados entram — um achado UNVERIFIED não é
   * descoberta, é alegação (§B6).
   *
   * Um achado com `canonicalId` JÁ mapeado no inventário canônico não é
   * novidade: é confirmação. Só capacidade/jornada/regra NÃO mapeada conta.
   * Novidade INCREMENTAL (2026-09-16): `seen` é o acumulado COMPARTILHADO da
   * curva — itens já emitidos por benchmarks anteriores (na ordem do
   * discovery) ou já conhecidos do sample anterior não contam como novos de
   * novo. A curva do engine mede "o que cada benchmark ACRESCENTA", e sem o
   * acumulado a mesma descoberta inflava a taxa de todo benchmark tardio.
   */
  function buildNovelty(findings, sourcesById, benchmark = null, seen = new Map()) {
    const novelty = emptyNovelty();
    for (const finding of findings) {
      if (finding.verified !== true) continue;
      // §TAREFA 20 do engine: achado já mapeado no inventário canônico é
      // CONFIRMAÇÃO, não novidade.
      if (isNonEmptyString(finding.canonical_id)) continue;
      const fields = NOVELTY_FIELDS[finding.kind];
      if (!fields) continue;

      const metadata = finding.metadata && typeof finding.metadata === 'object' ? finding.metadata : {};
      // §TAREFA 18 — inferência interna (RAP_DERIVED) NÃO é observação do
      // concorrente: atribuí-la ao fornecedor seria inventar evidência externa.
      if (metadata.origin === FINDING_ORIGINS.RAP_DERIVED) continue;
      // Missão semântica 2026-09-15 — UNRESOLVED_SEMANTIC_CANDIDATE é "ainda não
      // classificado", NUNCA novidade canônica. Ele é persistido para auditoria
      // e acompanhado em `unresolvedSemanticCandidates`, fora dos contadores.
      if (metadata.semanticStatus === SEMANTIC_STATUS.UNRESOLVED) continue;
      // §TAREFA 02/03 — o fornecedor é o sujeito, nunca uma capacidade nova.
      if (isSubjectNameFinding({ candidate: finding.external_name, benchmark: benchmark || {} })) continue;

      const sourceRow = finding.source_id ? sourcesById.get(finding.source_id) : null;
      // §TAREFA 23 — a identidade do item é o id canônico/normalizado. O nome do
      // concorrente nunca entra como identidade da novidade.
      const normalizedId = metadata.normalizedId
        || normalizeFindingName({ externalName: finding.external_name, kind: finding.kind }).canonicalId
        || null;
      const dedupeKey = `${fields.new}:${normalizedId || String(finding.external_name || finding.id).toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.set(dedupeKey, true);

      const item = {
        id: finding.id,
        name: finding.external_name || null,
        normalizedId,
        origin: metadata.origin || null,
        // sourceRef/evidenceRef são IDs: precisam resolver contra as fontes do
        // benchmark e contra `sample.evidence` (gate evidenceTraceability).
        sourceRef: sourceRow ? sourceRow.id : null,
        evidenceRef: finding.evidence_id || null,
      };
      novelty[fields.new].push(item);
      const classification = String(finding.classification || '').toUpperCase();
      if (classification === 'CRITICAL') novelty[fields.critical].push(item);
      else if (classification === 'REQUIRED') novelty[fields.required].push(item);
    }
    return novelty;
  }

  /**
   * PATCH para o sample do engine — apenas campos de PESQUISA, no formato que o
   * engine realmente valida:
   *   - `findingsInventory` é ARRAY de referências (não contadores);
   *   - `inventoryVersion` por benchmark (exigido por `analysisEvidence`);
   *   - `sources[]` com `id` (para `sourceRef` resolver);
   *   - `evidence[]` declarada (para `evidenceRef` resolver);
   *   - apenas achados VERIFICADOS alimentam `novelty`.
   *
   * Baseline canônico, arquétipos, dimensões e criticalidade NÃO são tocados.
   */
  /**
   * PATCH para o sample do engine — apenas campos de PESQUISA, no formato que o
   * engine realmente valida:
   *   - `findingsInventory` é ARRAY de referências (não contadores);
   *   - `inventoryVersion` por benchmark (exigido por `analysisEvidence`);
   *   - `sources[]` com `id` (para `sourceRef` resolver);
   *   - `evidence[]` declarada (para `evidenceRef` resolver);
   *   - apenas achados VERIFICADOS alimentam `novelty`.
   *
   * Baseline canônico, arquétipos, dimensões e criticalidade NÃO são tocados.
   *
   * `priorSample` (ciclo N+1): o acumulado de novidade começa no que o sample
   * versionado JÁ conhece — exceto os benchmarks cobertos por ESTE run, cuja
   * novelty está sendo substituída (semeá-la impediria a re-medida).
   */
  async function buildSamplePatch({ tenantId, vertical, inventoryVersion = null, priorSample = null }) {
    const tenant = requireTenant(tenantId);
    const run = await store.getRun({ tenantId: tenant, vertical });
    if (!run) throw blocker(RESEARCH_BLOCKERS.NO_DISCOVERY_SET, String(vertical));

    const [subjects, findings, sources, evidenceRows] = await Promise.all([
      store.listSubjects({ tenantId: tenant, runId: run.id }),
      store.listFindings({ tenantId: tenant, runId: run.id }),
      store.listSources({ tenantId: tenant, runId: run.id }),
      store.listEvidence({ tenantId: tenant, runId: run.id }),
    ]);
    const sourcesById = new Map(sources.map((row) => [row.id, row]));

    // Acumulado de identidades de novidade: semeado pelo sample anterior e
    // preenchido benchmark a benchmark NA ORDEM do discovery (o store devolve
    // os subjects em discovery_order ASC).
    const subjectIds = new Set(subjects.map((subject) => String(subject.benchmark_id)));
    const accumulatedNovelty = new Map();
    for (const priorBenchmark of (Array.isArray(priorSample?.benchmarks) ? priorSample.benchmarks : [])) {
      if (subjectIds.has(String(priorBenchmark?.id ?? ''))) continue;
      for (const fields of Object.values(NOVELTY_FIELDS)) {
        const items = Array.isArray(priorBenchmark?.novelty?.[fields.new]) ? priorBenchmark.novelty[fields.new] : [];
        for (const item of items) {
          const identity = isNonEmptyString(item?.normalizedId)
            ? String(item.normalizedId)
            : String(item?.name ?? '').toLowerCase();
          if (identity) accumulatedNovelty.set(`${fields.new}:${identity}`, true);
        }
      }
    }

    return {
      vertical: run.vertical,
      researchVersion: run.research_version,
      holdoutBenchmarkId: run.holdout_benchmark_id || null,
      saturationReached: run.saturation_reached === true,
      inventoryVersion: inventoryVersion || null,
      evidence: evidenceRows.map((row) => ({
        id: row.id,
        benchmarkId: row.benchmark_id,
        url: row.source_id && sourcesById.has(row.source_id) ? sourcesById.get(row.source_id).url : null,
        evidenceRef: row.evidence_ref,
        capturedAt: toIso(row.captured_at),
      })),
      benchmarks: subjects.map((subject) => {
        const own = findings.filter((finding) => finding.benchmark_id === subject.benchmark_id);
        const ownVerified = own.filter((finding) => finding.verified === true);
        const ownSources = sources.filter((row) => row.benchmark_id === subject.benchmark_id);
        const analyzedAt = toIso(subject.analyzed_at);
        const subjectMetadata = subject.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
        const subjectBenchmark = subjectMetadata.benchmark || { id: subject.benchmark_id };
        const axisCompleteness = buildAxisCompleteness({ axes: subjectMetadata.researchAxes || {} });
        const unresolvedCount = own.filter((finding) => {
          const metadata = finding.metadata && typeof finding.metadata === 'object' ? finding.metadata : {};
          return metadata.semanticStatus === SEMANTIC_STATUS.UNRESOLVED;
        }).length;
        return {
          id: subject.benchmark_id,
          analyzedAt,
          researchVersion: analyzedAt ? (subject.research_version || run.research_version) : null,
          inventoryVersion: analyzedAt ? (inventoryVersion || null) : null,
          // FITNESS-ABS-13 — frescor é FATO da análise + agenda da POLÍTICA:
          // `researchedAt` espelha o `analyzedAt` persistido; `nextReviewAt`
          // deriva de `maximumBenchmarkReviewAgeDays` da política versionada.
          // Benchmark não analisado NÃO ganha freshness (declarar pesquisa que
          // não aconteceu é evidência fabricada).
          freshness: analyzedAt ? {
            researchedAt: analyzedAt.slice(0, 10),
            nextReviewAt: nextReviewDate(analyzedAt, DEFAULT_POLICY),
            status: 'FRESH',
          } : null,
          findingsInventory: analyzedAt ? ownVerified.map((finding) => finding.id) : null,
          marketArchetypeMapping: subject.market_archetype_mapping || null,
          // Completude por eixo: "pesquisado sem achados" é resultado legítimo;
          // "não pesquisado" não pode ser lido como zero novidade (TAREFA 21).
          axisCompleteness: axisCompleteness.axes,
          // "Ainda não classificado" é acompanhado SEPARADAMENTE da novidade —
          // nunca conta como capability/jornada/regra nova (missão semântica).
          unresolvedSemanticCandidates: unresolvedCount,
          pipelineMetrics: subjectMetadata.pipelineMetrics || null,
          sources: ownSources.map((row) => ({
            id: row.id,
            url: row.url,
            tier: row.tier,
            specificity: row.specificity,
            verified: row.verified === true,
            httpStatus: row.http_status,
            retrievedAt: (toIso(row.verified_at || row.created_at) || '').slice(0, 10) || null,
          })),
          novelty: buildNovelty(own, sourcesById, subjectBenchmark, accumulatedNovelty),
        };
      }),
    };
  }

  return {
    openDiscoverySet,
    recordFinding,
    recordSourceInspection,
    setAxisState,
    recordInspections,
    markAnalyzed,
    markApparentSaturation,
    summarize,
    buildSamplePatch,
    states: RESEARCH_STATES,
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

/**
 * FITNESS-ABS-13 — data da próxima revisão: `analyzedAt` + os dias declarados
 * na POLÍTICA versionada (`maximumBenchmarkReviewAgeDays`). Nunca constante
 * de código: mudar a política muda a agenda — como o engine exige.
 */
function nextReviewDate(analyzedAt, policy = DEFAULT_POLICY) {
  const days = Number(policy?.maximumBenchmarkReviewAgeDays) || 365;
  const base = Date.parse(analyzedAt);
  if (!Number.isFinite(base)) return null;
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

module.exports = {
  FINDING_KINDS,
  RESEARCH_STATES,
  RESEARCH_BLOCKERS,
  NOVELTY_FIELDS,
  DEFAULT_POLICY,
  classifyResearchSource,
  createBenchmarkResearchService,
};
