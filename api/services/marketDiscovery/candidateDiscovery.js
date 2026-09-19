'use strict';

/**
 * candidateDiscovery — universo de CANDIDATOS de mercado.
 *
 * Os concorrentes conhecidos do config da vertical (ex.: os 8 de
 * `config/benchmarks/fitness.json`) entram como SEED — entrada de referência,
 * NÃO a verdade. A descoberta pode (e deve) ACRESCENTAR candidatos novos
 * vindos dos resultados de pesquisa, e nenhum candidato — seed ou descoberto —
 * vira ACCEPTED sem `sourceEvidence` real: URL + (`evidenceRef` ou
 * `contentHash`) obtidos por capabilities governadas.
 *
 * "O agente achou relevante" sem evidência é REJEITADO: relevância declarada
 * não é prova de existência nem de pertencimento ao mercado.
 *
 * T-S2 (2026-09-15): existência ≠ pertencimento. Candidato de origem RESEARCH
 * passa pelo GATE DE RELEVÂNCIA (`relevance.js`): o conteúdo da página obtida
 * precisa casar os termos de categoria do `marketContext` da vertical (mínimo
 * de sinais declarado), e a identidade do candidato é o DOMÍNIO REGISTRÁVEL do
 * site oficial — não o título da página. Página fora do mercado vira
 * OUT_OF_MARKET com o motivo nominal. Seeds carregam evidência de declaração
 * (o sample governado os pré-registrou) e não passam pelo gate de conteúdo.
 *
 * Este módulo é PURO (zero I/O).
 */

const { normalizeArchetypeKey, isValidEvidenceItem } = require('./archetypeDiscovery');
const { registrableDomain, RELEVANCE_STATES } = require('./relevance');

const CANDIDATE_STATES = Object.freeze({
  /** Seed de referência ou descoberto, ainda sem evidência suficiente. */
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',
  /** Aceito no universo: evidência real liga o candidato ao mercado. */
  ACCEPTED: 'ACCEPTED',
  /** Rejeitado com motivo auditável (ex.: evidência contraditória). */
  REJECTED: 'REJECTED',
  /**
   * Página obtida, mas o conteúdo NÃO pertence à categoria de mercado
   * declarada pela vertical (gate de relevância — T-S2, 2026-09-15).
   * Existência ≠ pertencimento: Wikipedia/loja de roupa/help center são
   * obtíveis e continuam fora do universo.
   */
  OUT_OF_MARKET: 'OUT_OF_MARKET',
});

const CANDIDATE_ORIGINS = Object.freeze({
  SEED: 'seed',
  RESEARCH: 'research',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  return list(value).map((item) => String(item ?? '').trim()).filter(Boolean);
}

/** Chave estável do candidato (identidade de upsert idempotente). */
function normalizeCandidateKey(name) {
  return normalizeArchetypeKey(name);
}

/**
 * Identidade de MERCADO do candidato (T-S2): o DOMÍNIO REGISTRÁVEL do site
 * oficial, não o título da página. O título varia por página/idioma e deixava
 * o mesmo fornecedor entrar várias vezes no universo; o domínio é estável.
 * Sem site oficial parseável, cai para o nome normalizado (seed sem URL).
 */
function candidateIdentityKey({ officialSite = null, name = null } = {}) {
  return registrableDomain(officialSite) || normalizeCandidateKey(name);
}

/**
 * Veredito de aceitação de UM candidato. Saída auditável — nunca booleano solto.
 *
 * Gate de relevância (T-S2): candidato de origem RESEARCH com veredito de
 * mercado AVALIADO e negativo é OUT_OF_MARKET — a página existe, mas não
 * pertence à categoria. Seeds carregam evidência de DECLARAÇÃO (o sample
 * governado os pré-registrou) e não passam pelo gate de conteúdo.
 *
 * @returns {{accepted: boolean, state: string, reason: string, evidenceCount: number}}
 */
function evaluateCandidateAcceptance(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_record_missing', evidenceCount: 0 };
  }
  if (!isNonEmptyString(candidate.name)) {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_name_missing', evidenceCount: 0 };
  }
  const relevance = candidate.marketRelevance;
  const relevanceEvaluated = relevance && typeof relevance === 'object' && relevance.evaluated === true;
  if (candidate.origin === CANDIDATE_ORIGINS.RESEARCH
    && relevanceEvaluated
    && relevance.state === RELEVANCE_STATES.OUT_OF_MARKET) {
    return {
      accepted: false,
      state: CANDIDATE_STATES.OUT_OF_MARKET,
      reason: relevance.reason || 'candidate_out_of_market',
      evidenceCount: list(candidate.sourceEvidence).filter(isValidEvidenceItem).length,
    };
  }
  const evidence = list(candidate.sourceEvidence).filter(isValidEvidenceItem);
  if (evidence.length === 0) {
    return {
      accepted: false,
      state: CANDIDATE_STATES.EVIDENCE_REQUIRED,
      reason: list(candidate.sourceEvidence).length > 0 ? 'candidate_evidence_invalid' : 'candidate_without_evidence',
      evidenceCount: 0,
    };
  }
  if (evidence.every((item) => item.contradicts === true)) {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_contradicted_by_evidence', evidenceCount: evidence.length };
  }
  return { accepted: true, state: CANDIDATE_STATES.ACCEPTED, reason: 'candidate_evidence_accepted', evidenceCount: evidence.length };
}

/**
 * Normaliza um registro de candidato. O estado é computado da evidência —
 * o chamador não escolhe ACCEPTED.
 *
 * Campos do registro: name, vendor, officialSite, officialDocs, apiDocs,
 * country/region, segments, targetCustomers, archetypes, independenceGroup,
 * cloneOf/baseProduct, sourceEvidence, rationale.
 */
function buildCandidateRecord({
  vertical,
  name,
  vendor = null,
  officialSite = null,
  officialDocs = null,
  apiDocs = null,
  country = null,
  region = null,
  segments = [],
  targetCustomers = [],
  archetypes = [],
  independenceGroup = null,
  cloneOf = null,
  baseProduct = null,
  sourceEvidence = [],
  rationale = null,
  origin = CANDIDATE_ORIGINS.RESEARCH,
  marketRelevance = null,
  metadata = {},
}) {
  const normalizedOrigin = origin === CANDIDATE_ORIGINS.SEED ? CANDIDATE_ORIGINS.SEED : CANDIDATE_ORIGINS.RESEARCH;
  const candidateKey = candidateIdentityKey({ officialSite, name });
  const normalizedEvidence = list(sourceEvidence).map((item) => ({
    url: String(item?.url ?? ''),
    evidenceRef: item?.evidenceRef ? String(item.evidenceRef) : null,
    contentHash: item?.contentHash ? String(item.contentHash) : null,
    tier: Number.isFinite(Number(item?.tier)) ? Number(item.tier) : null,
    contradicts: item?.contradicts === true,
    note: item?.note ? String(item.note) : null,
  }));
  const normalizedRelevance = marketRelevance && typeof marketRelevance === 'object'
    ? {
      evaluated: marketRelevance.evaluated === true,
      state: String(marketRelevance.state || ''),
      accepted: marketRelevance.accepted !== false,
      reason: marketRelevance.reason ? String(marketRelevance.reason) : null,
      signalCount: Number(marketRelevance.signalCount) || 0,
      minSignals: Number.isFinite(Number(marketRelevance.minSignals)) ? Number(marketRelevance.minSignals) : null,
      matchedTerms: stringList(marketRelevance.matchedTerms),
      domain: marketRelevance.domain ? String(marketRelevance.domain) : null,
      // Auditoria do segundo juízo do gate (run real r14, 2026-09-16): quando
      // o veredito veio da HOMEPAGE (a página de sinal era login/etc.), a
      // origem é registrada — o veredito nunca se passa por casamento direto
      // da página de sinal. Na rejeição final, homepageChecked prova que a
      // decisão é do DOMÍNIO (duas páginas avaliadas).
      ...(marketRelevance.fallback ? { fallback: String(marketRelevance.fallback) } : {}),
      ...(marketRelevance.signalPageUrl ? { signalPageUrl: String(marketRelevance.signalPageUrl) } : {}),
      ...(Number.isFinite(Number(marketRelevance.signalPageSignals)) ? { signalPageSignals: Number(marketRelevance.signalPageSignals) } : {}),
      ...(marketRelevance.homepageChecked === true ? { homepageChecked: true } : {}),
      ...(Number.isFinite(Number(marketRelevance.homepageSignals)) ? { homepageSignals: Number(marketRelevance.homepageSignals) } : {}),
    }
    : null;
  const verdict = evaluateCandidateAcceptance({
    name,
    origin: normalizedOrigin,
    sourceEvidence: normalizedEvidence,
    marketRelevance: normalizedRelevance,
  });
  return {
    vertical: String(vertical ?? '').trim(),
    candidateKey,
    name: String(name ?? '').trim(),
    vendor: vendor ? String(vendor) : null,
    officialSite: officialSite ? String(officialSite) : null,
    officialDocs: officialDocs ? String(officialDocs) : null,
    apiDocs: apiDocs ? String(apiDocs) : null,
    country: country ? String(country) : null,
    region: region ? String(region) : null,
    segments: stringList(segments),
    targetCustomers: stringList(targetCustomers),
    archetypes: stringList(archetypes).map(normalizeArchetypeKey),
    independenceGroup: independenceGroup ? String(independenceGroup) : null,
    // `cloneOf` aponta para a IDENTIDADE do alvo — mesma regra das chaves:
    // domínio registrável quando o valor é parseável como host/URL, senão o
    // nome normalizado.
    cloneOf: cloneOf ? String(candidateIdentityKey({ officialSite: cloneOf, name: cloneOf })) : null,
    baseProduct: baseProduct ? String(baseProduct) : null,
    origin: normalizedOrigin,
    state: verdict.state,
    sourceEvidence: normalizedEvidence,
    rationale: rationale ? String(rationale) : verdict.reason,
    marketRelevance: normalizedRelevance,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

/**
 * Converte um benchmark do sample do config em SEED de referência. Seeds não
 * carregam evidência de pesquisa deste run — entram como EVIDENCE_REQUIRED e
 * precisam ser confirmados pela descoberta como qualquer candidato.
 */
function seedFromBenchmark(vertical, benchmark) {
  const primarySource = list(benchmark?.sources).find((source) => isNonEmptyString(source?.url));
  return {
    vertical,
    name: benchmark?.name || benchmark?.id,
    vendor: benchmark?.vendor || null,
    officialSite: primarySource?.url || null,
    officialDocs: null,
    apiDocs: null,
    country: benchmark?.dimensions?.geography || null,
    region: null,
    segments: [],
    targetCustomers: benchmark?.dimensions?.customerSize ? [benchmark.dimensions.customerSize] : [],
    archetypes: benchmark?.archetype ? [benchmark.archetype] : [],
    independenceGroup: benchmark?.independenceGroup || null,
    cloneOf: benchmark?.cloneOf || null,
    baseProduct: benchmark?.baseProduct || null,
    sourceEvidence: [],
    rationale: 'seed de referência do config da vertical; aguardando confirmação por pesquisa',
    origin: CANDIDATE_ORIGINS.SEED,
    metadata: {
      seedBenchmarkId: benchmark?.id || null,
      seedRole: benchmark?.role || null,
      // Nome declarado por humano no sample governado — rank acima de título
      // de busca no merge (ver NAME_SOURCE_RANKS).
      nameSource: 'declared',
    },
  };
}

/**
 * Chaves de identidade dos benchmarks JÁ PESQUISADOS do sample (ciclo
 * incremental — loop de absorção 2026-09-15).
 *
 * Um benchmark com `analyzedAt` tem novelty medida no sample versionado.
 * Re-selecioná-lo num novo ciclo criaria uma entrada fresca SEM pesquisa por
 * cima da medida (perda de evidência + identidade duplicada no sample). A
 * seleção incremental exclui exatamente estas chaves — derivadas pela MESMA
 * regra de identidade do universo (domínio registrável do site oficial, nome
 * normalizado como fallback), para que o seed confirmado e o benchmark do
 * sample falem a mesma língua.
 *
 * Benchmark NÃO analisado não é excluído: ainda é desconhecido legítimo.
 *
 * @param {object} sample config versionado da vertical
 * @returns {string[]} chaves de candidato já pesquisadas
 */
function researchedKeysFromSample(sample) {
  return list(sample?.benchmarks)
    .filter((benchmark) => isNonEmptyString(benchmark?.analyzedAt))
    .map((benchmark) => {
      const primarySource = list(benchmark?.sources).find((source) => isNonEmptyString(source?.url));
      return candidateIdentityKey({
        officialSite: primarySource?.url || benchmark?.officialSite || null,
        name: benchmark?.name || benchmark?.id || null,
      });
    })
    .filter(Boolean);
}

/**
 * Chaves de identidade do HOLDOUT PRÉ-REGISTRADO ainda não pesquisado
 * (run real r13, 2026-09-16).
 *
 * O holdout é escolhido ANTES de qualquer pesquisa profunda exatamente para
 * medir a generalização do inventário sobre um desconhecido. Enquanto não
 * analisado, ele NÃO pode entrar no discovery set de um novo ciclo — ser
 * pesquisado como membro do set apagaria o propósito da medição (leakage
 * estrutural). O r13 demonstrou o gap: com o pool elegível reduzido ao
 * próprio holdout, a seleção o consumiu e o run terminou sem handoff
 * (`holdout_unavailable_all_candidates_selected`).
 *
 * Reservado = benchmark do sample que é o holdout vigente (role `validation`
 * ou id declarado em `sample.holdout.benchmarkId`) E ainda não tem
 * `analyzedAt`. Uma vez analisado, deixa de ser desconhecido: sai da reserva
 * e passa a valer `researchedKeysFromSample`. A reserva NÃO o remove do pool
 * de seleção de holdout — o novo ciclo pode (e deve) re-confirmá-lo.
 *
 * @param {object} sample config versionado da vertical
 * @returns {string[]} chaves de candidato reservadas como holdout
 */
function reservedHoldoutKeysFromSample(sample) {
  const holdoutBenchmarkId = sample?.holdout?.benchmarkId || null;
  return list(sample?.benchmarks)
    .filter((benchmark) => !isNonEmptyString(benchmark?.analyzedAt)
      && (benchmark?.role === 'validation' || (holdoutBenchmarkId && benchmark?.id === holdoutBenchmarkId)))
    .map((benchmark) => {
      const primarySource = list(benchmark?.sources).find((source) => isNonEmptyString(source?.url));
      return candidateIdentityKey({
        officialSite: primarySource?.url || benchmark?.officialSite || null,
        name: benchmark?.name || benchmark?.id || null,
      });
    })
    .filter(Boolean);
}

/**
 * Funde SEEDS + resultados de pesquisa no universo de candidatos.
 *
 * Merge por `candidateKey`: quando a pesquisa confirma um seed, a evidência é
 * ACRESCENTADA ao registro do seed (o seed sai de EVIDENCE_REQUIRED para o
 * estado que a evidência justificar) — nunca nasce um segundo candidato.
 * Candidatos NOVOS (além dos seeds) entram normalmente, com evidência.
 *
 * @returns {{candidates: Array, rejected: Array, stats: object}}
 */
function discoverCandidates({ vertical, seeds = [], researchResults = [] }) {
  const byKey = new Map();

  for (const seed of list(seeds)) {
    const record = buildCandidateRecord({ ...seed, vertical, origin: CANDIDATE_ORIGINS.SEED });
    if (!record.candidateKey) continue;
    byKey.set(record.candidateKey, record);
  }

  for (const found of list(researchResults)) {
    const key = candidateIdentityKey({ officialSite: found?.officialSite, name: found?.name });
    if (!key) continue;
    const existing = byKey.get(key);
    const mergedEvidence = [
      ...list(existing?.sourceEvidence),
      ...list(found?.sourceEvidence),
    ];
    // Merge NÃO destrutivo (run real r9, 2026-09-16):
    // 1. Array VAZIO do registro novo não sobrescreve campo povoado — a
    //    confirmação de seed (que corre depois da varredura) chega com
    //    archetypes=[] e apagava os arquétipos derivados do mapeamento.
    // 2. Veredito de relevância: sem veredito registrado, vale o observado
    //    agora (a elegibilidade histórica lê market_relevance persistida).
    // 3. IN_MARKET é ESTÁVEL: relevância é propriedade do CANDIDATO — uma
    //    página posterior do mesmo domínio sem os termos de categoria não
    //    desmente a página que provou o pertencimento.
    const seedWins = existing && existing.origin === CANDIDATE_ORIGINS.SEED;
    const existingRelevance = existing?.marketRelevance || null;
    const foundRelevance = found?.marketRelevance || null;
    const existingInMarket = existingRelevance?.evaluated === true && existingRelevance?.state === RELEVANCE_STATES.IN_MARKET;
    const foundInMarket = foundRelevance?.evaluated === true && foundRelevance?.state === RELEVANCE_STATES.IN_MARKET;
    const mergedRelevance = (() => {
      if (!existingRelevance) return foundRelevance;
      if (!foundRelevance) return existingRelevance;
      if (existingInMarket && !foundInMarket) return existingRelevance;
      return foundRelevance;
    })();
    const foundEntries = Object.fromEntries(Object.entries(found || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .filter(([, value]) => !(Array.isArray(value) && value.length === 0)));
    // Nome por rank de proveniência (mesma regra do merge cross-run): um
    // título de resultado de busca não rebaixa um nome declarado ou extraído
    // da homepage do próprio fornecedor.
    const foundNameWins = !existing?.name
      || nameSourceRank(found?.metadata) > nameSourceRank(existing?.metadata);
    if (!foundNameWins && foundEntries.name) foundEntries.name = existing.name;
    const winningNameSource = foundNameWins
      ? (found?.metadata?.nameSource ?? existing?.metadata?.nameSource ?? null)
      : (existing?.metadata?.nameSource ?? found?.metadata?.nameSource ?? null);
    const record = buildCandidateRecord({
      ...(existing || {}),
      ...foundEntries,
      vertical,
      // A origem do seed é preservada no merge: ser seed não é demérito nem
      // privilégio — o que decide é a evidência acumulada.
      origin: existing ? existing.origin : CANDIDATE_ORIGINS.RESEARCH,
      sourceEvidence: mergedEvidence,
      marketRelevance: mergedRelevance,
      rationale: found?.rationale
        || (existing ? 'seed confirmado por evidência de pesquisa' : null),
      metadata: {
        ...(existing?.metadata || {}),
        ...(found?.metadata || {}),
        ...(seedWins && found?.marketRelevance ? { observedMarketRelevance: found.marketRelevance } : {}),
        ...(winningNameSource ? { nameSource: winningNameSource } : {}),
      },
    });
    byKey.set(key, record);
  }

  const candidates = [...byKey.values()]
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));

  return {
    candidates,
    accepted: candidates.filter((c) => c.state === CANDIDATE_STATES.ACCEPTED),
    evidenceRequired: candidates.filter((c) => c.state === CANDIDATE_STATES.EVIDENCE_REQUIRED),
    rejected: candidates
      .filter((c) => c.state === CANDIDATE_STATES.REJECTED)
      .map((c) => ({ candidateKey: c.candidateKey, rationale: c.rationale })),
    outOfMarket: candidates
      .filter((c) => c.state === CANDIDATE_STATES.OUT_OF_MARKET)
      .map((c) => ({
        candidateKey: c.candidateKey,
        rationale: c.rationale,
        relevance: c.marketRelevance
          ? { reason: c.marketRelevance.reason, signalCount: c.marketRelevance.signalCount, minSignals: c.marketRelevance.minSignals }
          : null,
      })),
    stats: {
      seeds: list(seeds).length,
      researchResults: list(researchResults).length,
      universe: candidates.length,
      beyondSeeds: candidates.filter((c) => c.origin === CANDIDATE_ORIGINS.RESEARCH).length,
    },
  };
}

/**
 * Ranks de proveniência do NOME do candidato (merge cross-run, 2026-09-16).
 * Um nome extraído do <title> da homepage do PRÓPRIO fornecedor vale mais que
 * o rótulo derivado do domínio, que vale mais que o título de um resultado de
 * busca (fonte do lixo pré-fix: listicles como "Top 11 Alternatives..."
 * viraram nome de fornecedor). Registro legado sem `metadata.nameSource`
 * recebe o rank de `search_title` — foi de lá que os nomes ruins vieram.
 */
const NAME_SOURCE_RANKS = Object.freeze({
  homepage_title: 40,
  declared: 30,
  domain_label: 20,
  search_title: 10,
  url: 0,
});

function nameSourceRank(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata.nameSource : null;
  if (source && Object.prototype.hasOwnProperty.call(NAME_SOURCE_RANKS, source)) {
    return NAME_SOURCE_RANKS[source];
  }
  return NAME_SOURCE_RANKS.search_title;
}

/** União por url, ordem estável: o incoming ATUALIZA o item da mesma fonte. */
function unionEvidenceByUrl(persistedEvidence, incomingEvidence) {
  const byUrl = new Map();
  for (const item of list(persistedEvidence)) {
    if (isNonEmptyString(item?.url) && !byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  for (const item of list(incomingEvidence)) {
    if (isNonEmptyString(item?.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

function sortedUnion(persistedList, incomingList) {
  return [...new Set([...list(persistedList), ...list(incomingList)].map((v) => String(v ?? '').trim()).filter(Boolean))].sort();
}

/**
 * Veredito de relevância no merge cross-run:
 *  - host excluído pela POLÍTICA VIGENTE (`candidate_host_excluded`) VENCE um
 *    IN_MARKET histórico — o aceite anterior foi erro de política, não fato;
 *  - fora isso, IN_MARKET persistido é ESTÁVEL: uma página posterior sem os
 *    termos de categoria não desmente a página que provou o pertencimento (o
 *    veredito divergente fica auditável em `observedMarketRelevance`);
 *  - incoming sem veredito nunca apaga o persistido.
 */
function mergeRelevanceVerdicts(persistedRelevance, incomingRelevance) {
  if (!persistedRelevance || typeof persistedRelevance !== 'object') {
    return { relevance: incomingRelevance || null, observed: null };
  }
  if (!incomingRelevance || typeof incomingRelevance !== 'object') {
    return { relevance: persistedRelevance, observed: null };
  }
  const persistedInMarket = persistedRelevance.evaluated === true
    && persistedRelevance.state === RELEVANCE_STATES.IN_MARKET;
  const incomingInMarket = incomingRelevance.evaluated === true
    && incomingRelevance.state === RELEVANCE_STATES.IN_MARKET;
  const incomingHostExcluded = incomingRelevance.evaluated === true
    && incomingRelevance.state === RELEVANCE_STATES.OUT_OF_MARKET
    && incomingRelevance.reason === 'candidate_host_excluded';
  if (incomingHostExcluded) return { relevance: incomingRelevance, observed: null };
  if (persistedInMarket && !incomingInMarket) return { relevance: persistedRelevance, observed: incomingRelevance };
  return { relevance: incomingRelevance, observed: null };
}

/**
 * Merge CROSS-RUN com o registro PERSISTIDO (run real de 2026-09-16,
 * woliba.io): o upsert do store sobrescrevia a linha com a visão do run
 * corrente — uma confirmação com fetch falho apagou evidência, relevância e
 * nome de um candidato ACEITO. A verdade do candidato vive na tabela
 * `market_candidates`: o merge ACUMULA (evidência por url, arquétipos,
 * segmentos), IN_MARKET é estável, nome respeita o rank de proveniência e o
 * ESTADO é recomputado do registro fundido — nunca escolhido pelo chamador.
 *
 * @param {object|null} persisted registro persistido (qualquer camada de
 *   mapeamento — usar `candidateRecordFromPersistence` para linhas do store)
 * @param {object} incoming registro do run corrente
 */
function mergeCandidateRecords(persisted, incoming) {
  if (!persisted || typeof persisted !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return persisted;

  const sourceEvidence = unionEvidenceByUrl(persisted.sourceEvidence, incoming.sourceEvidence);
  const { relevance, observed } = mergeRelevanceVerdicts(persisted.marketRelevance, incoming.marketRelevance);

  const incomingNameWins = nameSourceRank(incoming.metadata) > nameSourceRank(persisted.metadata)
    && isNonEmptyString(incoming.name);
  const name = incomingNameWins
    ? String(incoming.name).trim()
    : String(persisted.name ?? incoming.name ?? '').trim();
  const nameSource = incomingNameWins
    ? incoming.metadata?.nameSource
    : (persisted.metadata?.nameSource || incoming.metadata?.nameSource || null);

  const scalar = (field) => (isNonEmptyString(incoming[field])
    ? String(incoming[field]).trim()
    : (isNonEmptyString(persisted[field]) ? String(persisted[field]).trim() : null));

  const merged = {
    vertical: incoming.vertical || persisted.vertical,
    candidateKey: persisted.candidateKey || incoming.candidateKey,
    name,
    vendor: scalar('vendor'),
    officialSite: scalar('officialSite'),
    officialDocs: scalar('officialDocs'),
    apiDocs: scalar('apiDocs'),
    country: scalar('country'),
    region: scalar('region'),
    segments: sortedUnion(persisted.segments, incoming.segments),
    targetCustomers: sortedUnion(persisted.targetCustomers, incoming.targetCustomers),
    archetypes: sortedUnion(persisted.archetypes, incoming.archetypes),
    independenceGroup: scalar('independenceGroup'),
    cloneOf: scalar('cloneOf'),
    baseProduct: scalar('baseProduct'),
    // A origem seed persistida prevalece: ser seed não é demérito nem
    // privilégio — o que decide aceitação é a evidência acumulada.
    origin: persisted.origin === CANDIDATE_ORIGINS.SEED
      ? CANDIDATE_ORIGINS.SEED
      : (incoming.origin || persisted.origin || CANDIDATE_ORIGINS.RESEARCH),
    sourceEvidence,
    rationale: isNonEmptyString(incoming.rationale) ? incoming.rationale : (persisted.rationale ?? null),
    marketRelevance: relevance,
    metadata: {
      ...(persisted.metadata && typeof persisted.metadata === 'object' ? persisted.metadata : {}),
      ...(incoming.metadata && typeof incoming.metadata === 'object' ? incoming.metadata : {}),
      ...(nameSource ? { nameSource } : {}),
      ...(observed ? { observedMarketRelevance: observed } : {}),
    },
  };
  const verdict = evaluateCandidateAcceptance({
    name: merged.name,
    origin: merged.origin,
    sourceEvidence: merged.sourceEvidence,
    marketRelevance: merged.marketRelevance,
  });
  merged.state = verdict.state;
  return merged;
}

/**
 * Mapeia uma linha PERSISTIDA do store (snake_case) para o formato de registro
 * usado pelo merge. Campos ausentes ficam null/[] — nunca inventados.
 */
function candidateRecordFromPersistence(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    vertical: row.vertical ?? null,
    candidateKey: row.candidate_key ?? row.candidateKey ?? null,
    name: row.name ?? null,
    vendor: row.vendor ?? null,
    officialSite: row.official_site ?? row.officialSite ?? null,
    officialDocs: row.official_docs ?? row.officialDocs ?? null,
    apiDocs: row.api_docs ?? row.apiDocs ?? null,
    country: row.country ?? null,
    region: row.region ?? null,
    segments: list(row.segments),
    targetCustomers: list(row.target_customers ?? row.targetCustomers),
    archetypes: list(row.archetypes),
    independenceGroup: row.independence_group ?? row.independenceGroup ?? null,
    cloneOf: row.clone_of ?? row.cloneOf ?? null,
    baseProduct: row.base_product ?? row.baseProduct ?? null,
    origin: row.origin ?? null,
    state: row.state ?? null,
    sourceEvidence: list(row.source_evidence ?? row.sourceEvidence),
    rationale: row.rationale ?? null,
    marketRelevance: row.market_relevance ?? row.marketRelevance ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

module.exports = {
  CANDIDATE_STATES,
  CANDIDATE_ORIGINS,
  NAME_SOURCE_RANKS,
  normalizeCandidateKey,
  candidateIdentityKey,
  evaluateCandidateAcceptance,
  buildCandidateRecord,
  seedFromBenchmark,
  researchedKeysFromSample,
  reservedHoldoutKeysFromSample,
  discoverCandidates,
  mergeCandidateRecords,
  candidateRecordFromPersistence,
  assessDiscoveryInputViability,
};

/**
 * A descoberta recebeu entrada util? Um provider quebrado se disfarca de mercado vazio.
 *
 * DEFEITO MEDIDO (2026-09-19): o provider de busca devolveu conteudo SEM RELACAO
 * com a query (gateway de pagamento `login.authorize.net` para
 * "bakery management software"). O run de `bakery` avaliou 23 candidatos e
 * rejeitou TODOS por `category_signals_below_minimum` — nenhum casou um unico
 * termo de categoria, com `minSignals: 1`. O sistema registrou isso como
 * "mercado sem players" e so falhou tres camadas adiante, no handoff
 * (`market_discovery_handoff_unavailable`, HTTP 400), longe da causa.
 *
 * Zero aceitos NAO e o mesmo em dois casos distintos:
 *   - mercado vazio de verdade  -> os candidatos tem sinal de categoria e sao
 *     recusados por outro criterio (dreh, evidencia, independentencia);
 *   - provider que nao respondeu -> TODOS recusados exatamente por falta de
 *     sinal de categoria, com um minimo de 1 termo. Um unico termo de
 *     categoria casando ja seria sinal de que a pagina e do dominio; zero em
 *     100% da amostra e falha de entrada, nao veredito de mercado.
 *
 * Puro e sem I/O: recebe os mesmos arrays que `discoverCandidates` ja devolve.
 *
 * @param {{universe?: number, accepted?: Array, evidenceRequired?: Array, outOfMarket?: Array}} input
 * @returns {{degenerate: boolean, reason: (string|null), detail?: string, evaluated?: number}}
 */
function assessDiscoveryInputViability({ universe = 0, accepted = [], evidenceRequired = [], outOfMarket = [] } = {}) {
  const total = Number(universe) || 0;
  const acceptedCount = list(accepted).length;
  const evidenceRequiredCount = list(evidenceRequired).length;
  const out = list(outOfMarket);

  const viable = { degenerate: false, reason: null };

  if (total === 0) return viable;
  if (acceptedCount + evidenceRequiredCount > 0) return viable;
  if (out.length === 0) return viable;

  const allWithoutCategorySignal = out.every(
    (item) => item && item.relevance && item.relevance.reason === 'category_signals_below_minimum'
  );
  if (!allWithoutCategorySignal) return viable;

  return {
    degenerate: true,
    reason: 'provider_returned_no_relevant_candidates',
    evaluated: out.length,
    detail:
      `${out.length} candidatos avaliados e nenhum casou um unico termo de categoria ` +
      '(minSignals=1); a busca nao devolveu conteudo relacionado a query. ' +
      'Isto e falha de entrada do provider, nao ausencia de players no mercado.',
  };
}
