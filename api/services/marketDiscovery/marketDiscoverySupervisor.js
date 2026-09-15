'use strict';

/**
 * Market Discovery Supervisor — orquestrador da DESCOBERTA AUTÔNOMA DE
 * MERCADO, a camada que antecede o Discovery Set de benchmarks:
 *
 *   MARKET → ARCHETYPES → CANDIDATES → CANDIDATE ANALYSIS → DIVERSITY →
 *   DISCOVERY SET → HOLDOUT PREREGISTRATION → DEEP RESEARCH (handoff)
 *
 * Antes desta camada, o discovery set era "o que o chamador passou" e o
 * config da vertical era a única fonte de arquétipos e concorrentes. Aqui o
 * mercado é varrido por capabilities de pesquisa GOVERNADAS (`research.*`,
 * de `api/services/benchmark/researchCapabilities.js`) executadas pelo
 * Canonical Tool Registry — o supervisor nunca toca a rede diretamente e os
 * runners são INJETADOS (rede/MCP real em produção, controlado em teste).
 *
 * Regras duras:
 *   - classificação DEVELOPMENT, tenant SYSTEM (descoberta de mercado é
 *     superfície de engenharia, nunca PRODUCTION);
 *   - sem provider para as capabilities de pesquisa o run é
 *     `MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS` — nada é aceito, nenhum
 *     arquétipo/candidato muda de estado por ausência de trabalho;
 *   - arquétipo sem evidência não é ACCEPTED (revalidação, não confiança);
 *   - candidato sem evidência não entra no universo aceito — os 8 concorrentes
 *     do config são SEED de referência, não verdade;
 *   - clone/white-label nunca conta como diversidade real;
 *   - o holdout é pré-registrado ANTES de qualquer pesquisa profunda; leakage
 *     é FAIL com o set em LEAKAGE_DETECTED;
 *   - o supervisor NÃO executa pesquisa profunda: produz o handoff para o
 *     subsistema de benchmark research (benchmarkIds + holdoutBenchmarkId).
 */

const {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
  ensureResearchCapabilities,
  executeResearchCapability,
} = require('../benchmark/researchCapabilities');
const { assertSystemTenant } = require('../benchmark/benchmarkResearchSemantics');
const {
  revalidateArchetypes,
  ARCHETYPE_STATES,
} = require('./archetypeDiscovery');
const {
  discoverCandidates,
  seedFromBenchmark,
  CANDIDATE_STATES,
} = require('./candidateDiscovery');
const { independenceReport } = require('./independence');
const { selectDiscoverySet, selectHoldout, SELECTION_WEIGHTS, DEFAULT_SET_SIZE } = require('./discoverySetSelection');
const { createHoldoutPreregistration, HOLDOUT_SET_STATES } = require('./holdoutPreregistration');
const { buildMarketQueries } = require('./marketQueries');
const { evaluateMarketRelevance, RELEVANCE_STATES } = require('./relevance');

/** A capability canônica pela qual o runtime alcança a descoberta de mercado. */
const MARKET_DISCOVERY_CAPABILITY = Object.freeze({
  id: 'rap.market.discovery.supervisor',
  capability: 'market.discovery.execute',
  aliases: Object.freeze(['market.discovery.execute']),
  visibility: 'DEVELOPMENT',
  permissions: Object.freeze(['market.discovery.execute']),
  description: 'Executa a descoberta autônoma de mercado de uma vertical (arquétipos, candidatos, discovery set, pré-registro de holdout).',
  runner: 'execute',
  riskLevel: 'low',
  // Gravação INTERNA de artefato SYSTEM (nunca mutação de domínio de cliente).
  sideEffects: false,
  confirmationPolicy: 'autonomous',
  idempotencyPolicy: 'recommended',
  executionMode: 'durable',
  version: '1.0.0',
});

/** Estados do run de descoberta (DECLARADOS, nunca inferidos de contagens). */
const DISCOVERY_RUN_STATES = Object.freeze({
  OPEN: 'MARKET_DISCOVERY_OPEN',
  MARKET_SCANNED: 'MARKET_SCANNED',
  ARCHETYPES_VALIDATED: 'ARCHETYPES_VALIDATED',
  CANDIDATES_DISCOVERED: 'CANDIDATES_DISCOVERED',
  CANDIDATES_ANALYZED: 'CANDIDATES_ANALYZED',
  DIVERSITY_EVALUATED: 'DIVERSITY_EVALUATED',
  DISCOVERY_SET_SELECTED: 'DISCOVERY_SET_SELECTED',
  HOLDOUT_PREREGISTERED: 'HOLDOUT_PREREGISTERED',
  HANDED_OFF: 'MARKET_DISCOVERY_HANDED_OFF',
  BLOCKED: 'MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS',
});

const DISCOVERY_RUN_OUTCOMES = Object.freeze({
  BLOCKED_NO_EXTERNAL_ACCESS: 'MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS',
  COMPLETED: 'MARKET_DISCOVERY_COMPLETED',
});

/** Permissões NOMINAIS do principal de descoberta (sem wildcard). */
const DISCOVERY_PRINCIPAL_PERMISSIONS = Object.freeze([
  'market.discovery.execute',
  ...RESEARCH_CAPABILITY_IDS,
]);

function buildDiscoveryPrincipal({ permissions = DISCOVERY_PRINCIPAL_PERMISSIONS } = {}) {
  return {
    classification: 'DEVELOPMENT',
    tenant: 'system',
    domain: 'SYSTEM',
    permissions: [...permissions],
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Registra a capability do supervisor no Canonical Tool Registry
 * (idempotente). Runner ausente é ERRO — capability declarada sem executor é
 * promessa vazia.
 */
function ensureMarketDiscoveryCapability(registry, runners = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('market_discovery_registry_required');
  }
  if (registry.get(MARKET_DISCOVERY_CAPABILITY.id)) {
    return { registered: [], existing: [MARKET_DISCOVERY_CAPABILITY.id] };
  }
  const runner = runners[MARKET_DISCOVERY_CAPABILITY.runner];
  if (typeof runner !== 'function') {
    throw new Error(`market_discovery_runner_missing: ${MARKET_DISCOVERY_CAPABILITY.runner}`);
  }

  registry.register({
    id: MARKET_DISCOVERY_CAPABILITY.id,
    aliases: [...MARKET_DISCOVERY_CAPABILITY.aliases],
    capability: MARKET_DISCOVERY_CAPABILITY.capability,
    visibility: MARKET_DISCOVERY_CAPABILITY.visibility,
    permissions: [...MARKET_DISCOVERY_CAPABILITY.permissions],
    description: MARKET_DISCOVERY_CAPABILITY.description,
    riskLevel: MARKET_DISCOVERY_CAPABILITY.riskLevel,
    sideEffects: MARKET_DISCOVERY_CAPABILITY.sideEffects,
    confirmationPolicy: MARKET_DISCOVERY_CAPABILITY.confirmationPolicy,
    idempotencyPolicy: MARKET_DISCOVERY_CAPABILITY.idempotencyPolicy,
    executionMode: MARKET_DISCOVERY_CAPABILITY.executionMode,
    inputSchema: {
      type: 'object',
      required: ['vertical'],
      properties: {
        vertical: { type: 'string' },
        discoveryVersion: { type: 'string' },
        sample: { type: 'object' },
      },
      additionalProperties: false,
    },
    version: MARKET_DISCOVERY_CAPABILITY.version,
    metadata: Object.freeze({
      provider: 'native',
      domain: 'SYSTEM',
      surface: 'market-discovery',
      capability: MARKET_DISCOVERY_CAPABILITY.capability,
      outputTrust: 'DATA_ONLY',
    }),
    execute: (input, context) => runner(input || {}, { ...context, capability: MARKET_DISCOVERY_CAPABILITY.capability }),
  });

  return { registered: [MARKET_DISCOVERY_CAPABILITY.id], existing: [] };
}

/**
 * @param {object} args
 * @param {object} args.store      marketDiscoveryStore (Postgres) — obrigatório
 * @param {object} args.registry   Canonical Tool Registry
 * @param {object} [args.providers] runners REAIS das capabilities `research.*`
 * @param {string} [args.tenantId] tenant do run (descoberta é SYSTEM)
 * @param {object} [args.actor]    principal (DEVELOPMENT por definição)
 * @param {Function} [args.now]
 * @param {object} [args.logger]
 * @param {object} [args.selection] { size } tamanho alvo do discovery set
 */
function createMarketDiscoverySupervisor({
  store,
  registry,
  providers = {},
  tenantId,
  actor,
  now,
  logger,
  selection = {},
} = {}) {
  if (!store) throw new Error('persistence_required: market discovery store é obrigatório');
  if (!registry) throw new Error('market_discovery_registry_required');

  const log = logger || { info() {}, warn() {}, error() {}, debug() {} };
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  const discoveryTenant = assertSystemTenant(isNonEmptyString(tenantId) ? tenantId : 'system');
  const principal = actor || buildDiscoveryPrincipal();
  const holdouts = createHoldoutPreregistration({ store, now: clock });
  const setSize = Math.max(1, Number(selection.size) || DEFAULT_SET_SIZE);

  /**
   * Registra apenas as capabilities `research.*` cujo runner foi INJETADO
   * (mesma disciplina do benchmark research runner: runner ausente é ausência
   * de provider, não erro de programa).
   */
  function register() {
    const present = {};
    const missing = [];
    for (const definition of RESEARCH_CAPABILITIES) {
      const runner = providers?.[definition.runner];
      if (typeof runner !== 'function') {
        missing.push(definition.capability);
        continue;
      }
      present[definition.runner] = runner;
    }
    const registration = Object.keys(present).length > 0
      ? ensureResearchCapabilities(registry, present)
      : { registered: [], existing: [] };
    return { ...registration, missing };
  }

  function providerAvailability() {
    const available = RESEARCH_CAPABILITY_IDS.filter((capability) => typeof providers?.[
      RESEARCH_CAPABILITIES.find((d) => d.capability === capability)?.runner
    ] === 'function');
    const missing = RESEARCH_CAPABILITY_IDS.filter((capability) => !available.includes(capability));
    return {
      available,
      required: [...RESEARCH_CAPABILITY_IDS],
      missing,
      externalAccess: missing.length === 0,
      reason: missing.length === 0
        ? 'research_provider_available'
        : 'no_governed_research_provider: nenhuma conexão MCP/runner atende research.* neste runtime',
    };
  }

  async function executeResearch(capability, input) {
    return executeResearchCapability({
      registry,
      capability,
      tenantId: discoveryTenant,
      actor: principal,
      input,
    });
  }

  /**
   * Obtém evidência REAL para um termo: search → fetch (HTTP confirmado) →
   * captureEvidence (hash). Retorna item de evidência válido ou null com o
   * motivo registrado — nunca fabrica evidência.
   *
   * Falha de REDE de um candidato (timeout, bloqueio de endpoint) é um FATO da
   * descoberta, não uma exceção que derruba o run: um único host inalcançável
   * não pode abortar a varredura inteira. O motivo tipado do provider vai em
   * `reason` e o candidato simplesmente não acumula evidência (não entra no
   * universo aceito).
   */
  async function gatherEvidence({ query, url = null, tier = 5, note = null }) {
    let search;
    try {
      search = await executeResearch('research.search', { query });
    } catch (error) {
      return { evidence: null, reason: `search_failed: ${error?.code || error?.message || 'unknown'}` };
    }
    const candidates = list(search.output?.candidates);
    const targetUrl = url
      || candidates.find((candidate) => isNonEmptyString(candidate?.url))?.url
      || null;
    if (!targetUrl) return { evidence: null, reason: 'search_returned_no_source' };

    let fetch;
    try {
      fetch = await executeResearch('research.fetch', { url: targetUrl });
    } catch (error) {
      return { evidence: null, reason: `fetch_failed: ${error?.code || error?.message || 'unknown'}` };
    }
    const httpStatus = Number(fetch.output?.httpStatus);
    if (!Number.isFinite(httpStatus) || httpStatus >= 400 || !isNonEmptyString(fetch.output?.contentHash)) {
      return { evidence: null, reason: `fetch_not_confirmed: status=${fetch.output?.httpStatus ?? 'unknown'}` };
    }

    let capture;
    try {
      capture = await executeResearch('research.captureEvidence', {
        url: targetUrl,
        contentHash: fetch.output.contentHash,
        contentType: fetch.output.contentType || null,
      });
    } catch (error) {
      return { evidence: null, reason: `evidence_capture_failed: ${error?.code || error?.message || 'unknown'}` };
    }
    const evidenceRef = capture.output?.evidenceRef;
    if (!isNonEmptyString(evidenceRef)) return { evidence: null, reason: 'evidence_capture_without_ref' };

    return {
      evidence: {
        url: targetUrl,
        evidenceRef: String(evidenceRef),
        contentHash: String(fetch.output.contentHash),
        tier,
        note,
      },
      reason: null,
      content: fetch.output.content || null,
      contentHash: fetch.output.contentHash,
    };
  }

  /**
   * Estágio CANDIDATE ANALYSIS: profiling do candidato a partir do site/docs
   * oficiais. Grava `profiled_at` — NUNCA `deep_research_at` (a pesquisa
   * profunda é do subsistema de benchmark research, depois do handoff).
   */
  async function profileCandidate({ vertical, candidate }) {
    const site = candidate.official_site || candidate.officialSite;
    if (!isNonEmptyString(site)) {
      return { candidateKey: candidate.candidate_key || candidate.candidateKey, profiled: false, reason: 'candidate_without_official_site' };
    }

    const gathered = await gatherEvidence({ query: `${candidate.name || candidate.candidate_key} documentação oficial`, url: site, tier: 5 });
    if (!gathered.evidence) {
      return { candidateKey: candidate.candidate_key || candidate.candidateKey, profiled: false, reason: gathered.reason };
    }

    const dimensions = {};
    const docs = await executeResearch('research.inspectDocumentation', {
      url: site,
      content: gathered.content || '',
      contentHash: gathered.contentHash,
    });
    const sections = list(docs.output?.sections);
    dimensions.operationalDepth = sections.length >= 8 ? 'high' : (sections.length >= 3 ? 'medium' : 'low');

    const apiDocsUrl = candidate.api_docs || candidate.apiDocs || null;
    if (isNonEmptyString(apiDocsUrl)) {
      const api = await executeResearch('research.inspectApiDocs', { url: apiDocsUrl });
      const operations = list(api.output?.operations);
      dimensions.integrationMaturity = operations.length >= 10 ? 'high' : (operations.length > 0 ? 'medium' : 'low');
    } else {
      dimensions.integrationMaturity = 'low';
    }

    const profile = {
      dimensions: {
        operationalDepth: dimensions.operationalDepth,
        financialDepth: dimensions.financialDepth || 'medium',
        customerEngagementDepth: dimensions.customerEngagementDepth || 'medium',
        integrationMaturity: dimensions.integrationMaturity,
      },
      evidence: gathered.evidence,
      documentationSections: sections.length,
      profiledWith: ['research.fetch', 'research.inspectDocumentation'],
    };

    await store.updateCandidateProfile({
      tenantId: discoveryTenant,
      candidateId: candidate.id,
      profile,
      profiledAt: clock(),
    });
    return { candidateKey: candidate.candidate_key || candidate.candidateKey, profiled: true, profile };
  }

  /**
   * Executa a descoberta completa de UMA vertical.
   *
   * @param {object} args
   * @param {string} args.vertical
   * @param {string} args.discoveryVersion  versão determinística do run
   * @param {object} [args.sample]          config da vertical (seeds + arquétipos declarados)
   * @param {Array}  [args.marketQueries]   queries de varredura de mercado
   */
  async function discover({ vertical, discoveryVersion, sample = null, marketQueries = null } = {}) {
    const verticalId = requireString(vertical, 'vertical');
    const version = requireString(discoveryVersion, 'discoveryVersion');

    const run = await store.openRun({
      tenantId: discoveryTenant,
      vertical: verticalId,
      discoveryVersion: version,
      startedAt: clock(),
      metadata: { pipeline: ['MARKET', 'ARCHETYPES', 'CANDIDATES', 'CANDIDATE_ANALYSIS', 'DIVERSITY', 'DISCOVERY_SET', 'HOLDOUT_PREREGISTRATION', 'DEEP_RESEARCH_HANDOFF'] },
    });

    register();
    const availability = providerAvailability();
    if (!availability.externalAccess) {
      // Regra dura: sem acesso externo governado, NADA é aceito e o run é
      // declarado bloqueado — descoberta "sem sair da memória do modelo" seria
      // evidência fabricada.
      await store.updateRunState({
        tenantId: discoveryTenant,
        runId: run.id,
        state: DISCOVERY_RUN_STATES.BLOCKED,
        completedAt: clock(),
        metadata: { availability },
      });
      return {
        status: DISCOVERY_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS,
        vertical: verticalId,
        runId: run.id,
        availability,
      };
    }

    const declaredArchetypes = list(sample?.archetypes).map((a) => ({ ...a, vertical: verticalId }));
    const seeds = list(sample?.benchmarks).map((b) => seedFromBenchmark(verticalId, b));

    // ── MARKET ──────────────────────────────────────────────────────────
    // Queries DOMÍNIO-ESPECÍFICAS derivadas do contexto de mercado declarado
    // pela vertical (`marketContext` do sample). Queries genéricas poluem o
    // universo (a varredura real de 2026-09-15 descobriu lojas de roupa e
    // Wikipedia com "fitness software gestão mercado fornecedores").
    const queries = Array.isArray(marketQueries) && marketQueries.length > 0
      ? marketQueries
      : buildMarketQueries({ vertical: verticalId, sample });
    const marketScan = [];
    for (const query of queries) {
      const result = await executeResearch('research.search', { query });
      marketScan.push({ query, candidates: list(result.output?.candidates) });
    }
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.MARKET_SCANNED,
      metadata: { marketScan: marketScan.map((s) => ({ query: s.query, hits: s.candidates.length })) },
    });

    // ── ARCHETYPES ──────────────────────────────────────────────────────
    // Revalidação: CADA arquétipo declarado precisa de evidência DESTE run.
    // (Na vertical fitness, `financial-billing` e `student-digital-experience`
    // passam por aqui como qualquer outro — nunca removidos para forçar PASS,
    // nunca aceitos sem prova.)
    const evidenceByArchetype = {};
    const archetypeGaps = [];
    for (const archetype of declaredArchetypes) {
      const key = String(archetype.id || archetype.archetypeKey || '');
      const gathered = await gatherEvidence({
        query: `${verticalId} ${archetype.name || key} fornecedor oficial`,
        note: `revalidação do arquétipo ${key}`,
      });
      if (gathered.evidence) evidenceByArchetype[key] = [gathered.evidence];
      else archetypeGaps.push({ archetypeKey: key, reason: gathered.reason });
    }
    const revalidation = revalidateArchetypes({
      declared: declaredArchetypes,
      evidenceByArchetype,
      discovered: [],
    });
    for (const record of revalidation.records) {
      await store.upsertArchetype({
        tenantId: discoveryTenant,
        runId: run.id,
        archetype: { ...record, vertical: verticalId, validatedAt: clock() },
      });
    }
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.ARCHETYPES_VALIDATED,
      metadata: {
        archetypesAccepted: revalidation.accepted,
        archetypesEvidenceRequired: revalidation.evidenceRequired,
        archetypesRejected: revalidation.rejected,
      },
    });
    const acceptedArchetypeKeys = revalidation.accepted;

    // ── CANDIDATES ──────────────────────────────────────────────────────
    // Seeds são referência; a pesquisa confirma seeds e ACRESCENTA novos.
    // T-S2: cada candidato DESCOBERTO passa pelo gate de relevância — o
    // conteúdo obtido precisa casar os termos de categoria do marketContext
    // declarado. Página obtível fora do mercado (Wikipedia, loja de roupa,
    // help center) é persistida como OUT_OF_MARKET com o motivo, nunca como
    // membro do universo. A identidade é o domínio registrável, não o título.
    const marketContext = sample?.marketContext && typeof sample.marketContext === 'object'
      ? sample.marketContext
      : null;
    const researchResults = [];
    const seenUrls = new Set();
    for (const scan of marketScan) {
      for (const hit of scan.candidates) {
        if (!isNonEmptyString(hit?.url) || seenUrls.has(hit.url)) continue;
        seenUrls.add(hit.url);
        const gathered = await gatherEvidence({ query: `${hit.title || hit.url} oficial`, url: hit.url, tier: 5 });
        if (!gathered.evidence) continue;
        researchResults.push({
          name: hit.title || hit.url,
          officialSite: hit.url,
          country: hit.country || null,
          segments: list(hit.segments),
          targetCustomers: list(hit.targetCustomers),
          archetypes: list(hit.archetypes),
          independenceGroup: hit.independenceGroup || null,
          cloneOf: hit.cloneOf || null,
          sourceEvidence: [gathered.evidence],
          marketRelevance: evaluateMarketRelevance({
            content: gathered.content,
            url: hit.url,
            marketContext,
          }),
          rationale: `descoberto pela varredura de mercado: ${scan.query}`,
        });
      }
    }
    // Seeds com fonte declarada também são confirmados por pesquisa — um seed
    // sem confirmação permanece EVIDENCE_REQUIRED e NÃO entra no universo.
    for (const seed of seeds) {
      if (!seed.officialSite) continue;
      const gathered = await gatherEvidence({ query: `${seed.name} site oficial`, url: seed.officialSite, tier: 5 });
      if (gathered.evidence) {
        researchResults.push({
          name: seed.name,
          officialSite: seed.officialSite,
          country: seed.country,
          targetCustomers: seed.targetCustomers,
          archetypes: seed.archetypes,
          independenceGroup: seed.independenceGroup,
          sourceEvidence: [gathered.evidence],
        });
      }
    }
    const discovery = discoverCandidates({ vertical: verticalId, seeds, researchResults });
    for (const record of discovery.candidates) {
      await store.upsertCandidate({ tenantId: discoveryTenant, runId: run.id, candidate: { ...record, vertical: verticalId } });
    }
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.CANDIDATES_DISCOVERED,
      metadata: {
        candidateStats: discovery.stats,
        candidatesRejected: discovery.rejected,
        candidatesOutOfMarket: discovery.outOfMarket,
        relevanceGate: marketContext ? 'evaluated' : RELEVANCE_STATES.NOT_EVALUABLE,
      },
    });

    // ── CANDIDATE ANALYSIS ──────────────────────────────────────────────
    const accepted = await store.listCandidates({ tenantId: discoveryTenant, vertical: verticalId, state: CANDIDATE_STATES.ACCEPTED });
    const profiles = [];
    for (const candidate of accepted) {
      profiles.push(await profileCandidate({ vertical: verticalId, candidate }));
    }
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.CANDIDATES_ANALYZED,
      metadata: { profiles: profiles.map((p) => ({ candidateKey: p.candidateKey, profiled: p.profiled, reason: p.reason || null })) },
    });

    // ── DIVERSITY ───────────────────────────────────────────────────────
    const analyzed = await store.listCandidates({ tenantId: discoveryTenant, vertical: verticalId, state: CANDIDATE_STATES.ACCEPTED });
    const diversity = independenceReport(analyzed.map((row) => ({
      candidateKey: row.candidate_key,
      independenceGroup: row.independence_group,
      cloneOf: row.clone_of,
      baseProduct: row.base_product,
      metadata: row.metadata || {},
    })));
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.DIVERSITY_EVALUATED,
      metadata: { diversity },
    });

    // ── DISCOVERY SET ───────────────────────────────────────────────────
    const selectable = analyzed.map((row) => ({
      candidateKey: row.candidate_key,
      name: row.name,
      country: row.country,
      region: row.region,
      segments: list(row.segments),
      targetCustomers: list(row.target_customers),
      archetypes: list(row.archetypes),
      independenceGroup: row.independence_group,
      cloneOf: row.clone_of,
      baseProduct: row.base_product,
      profile: row.profile || null,
      metadata: row.metadata || {},
    }));
    const selectionResult = selectDiscoverySet({
      candidates: selectable,
      acceptedArchetypeKeys,
      size: setSize,
    });
    const set = await store.recordDiscoverySet({
      tenantId: discoveryTenant,
      runId: run.id,
      set: {
        vertical: verticalId,
        discoverySetVersion: version,
        selectedCandidates: selectionResult.selected,
        selectionRationale: selectionResult.rationale,
        selectionPolicy: selectionResult.policy,
        metadata: { excluded: selectionResult.excluded, weights: { ...SELECTION_WEIGHTS } },
      },
    });
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.DISCOVERY_SET_SELECTED,
      metadata: { discoverySetId: set.id, selected: selectionResult.selected },
    });

    // ── HOLDOUT PREREGISTRATION ─────────────────────────────────────────
    // ANTES de qualquer pesquisa profunda: escolha determinística + registro
    // de selectedAt/selectionBasis/preregistered.
    const holdoutChoice = selectHoldout({
      candidates: selectable,
      selectedKeys: selectionResult.selected,
      acceptedArchetypeKeys,
    });
    let holdout = null;
    if (holdoutChoice.holdoutKey) {
      await holdouts.preregisterHoldout({
        tenantId: discoveryTenant,
        setId: set.id,
        candidateKey: holdoutChoice.holdoutKey,
        selectionBasis: holdoutChoice.basis,
      });
      holdout = { candidateKey: holdoutChoice.holdoutKey, basis: holdoutChoice.basis, preregistered: true };
    } else {
      holdout = { candidateKey: null, basis: holdoutChoice.basis, preregistered: false };
    }
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.HOLDOUT_PREREGISTERED,
      metadata: { holdout },
    });

    // ── DEEP RESEARCH (handoff) ─────────────────────────────────────────
    // O supervisor NÃO pesquisa em profundidade: abre o set (verificação de
    // leakage inclusa) e devolve o contrato de handoff para o subsistema de
    // benchmark research (`openRun` de benchmarkResearchStore aceita
    // `benchmarkIds` + `holdoutBenchmarkId`).
    const opened = await holdouts.openForDeepResearch({ tenantId: discoveryTenant, setId: set.id });
    const handoff = {
      tenantId: discoveryTenant,
      vertical: verticalId,
      researchVersion: `${version}-deep-research`,
      benchmarkIds: [...selectionResult.selected],
      holdoutBenchmarkId: holdout.candidateKey,
      discoverySetId: set.id,
      discoveryRunId: run.id,
      holdoutPreregisteredAt: opened.holdout_selected_at,
    };
    await store.updateRunState({
      tenantId: discoveryTenant,
      runId: run.id,
      state: DISCOVERY_RUN_STATES.HANDED_OFF,
      completedAt: clock(),
      metadata: { handoff },
    });

    log.info('[market-discovery] run concluído', {
      tenant: discoveryTenant,
      vertical: verticalId,
      runId: run.id,
      discoverySet: selectionResult.selected.length,
      holdout: holdout.candidateKey,
      archetypesAccepted: acceptedArchetypeKeys.length,
      independentGroups: diversity.independentCount,
    });

    return {
      status: DISCOVERY_RUN_OUTCOMES.COMPLETED,
      vertical: verticalId,
      runId: run.id,
      availability,
      archetypes: {
        accepted: revalidation.accepted,
        evidenceRequired: revalidation.evidenceRequired,
        rejected: revalidation.rejected,
        gaps: archetypeGaps,
      },
      candidates: { ...discovery.stats, outOfMarket: discovery.outOfMarket },
      diversity,
      discoverySet: { id: set.id, selected: selectionResult.selected, rationale: selectionResult.rationale },
      holdout,
      handoff,
    };
  }

  return {
    tenantId: discoveryTenant,
    actor: principal,
    capability: MARKET_DISCOVERY_CAPABILITY,
    register,
    providerAvailability,
    discover,
    holdouts,
  };
}

function requireString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    const error = new Error(`market_discovery_invalid: ${field} é obrigatório`);
    error.code = 'market_discovery_invalid';
    throw error;
  }
  return normalized;
}

module.exports = {
  MARKET_DISCOVERY_CAPABILITY,
  DISCOVERY_RUN_STATES,
  DISCOVERY_RUN_OUTCOMES,
  DISCOVERY_PRINCIPAL_PERMISSIONS,
  buildDiscoveryPrincipal,
  ensureMarketDiscoveryCapability,
  createMarketDiscoverySupervisor,
};
