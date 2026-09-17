'use strict';

/**
 * benchmarkChangeProposalService — PROPOSTA DE MUDANÇA com aprovação humana.
 *
 * Política (2026-09-17): a pesquisa competitiva NUNCA aplica mudança diretamente
 * no sample versionado (`config/benchmarks/<vertical>.json`). O fluxo é:
 *
 *   pesquisa → PROPOSTA persistida (patch + avaliação documentada)
 *            → REVISÃO (token HMAC de 30 min, padrão journeyReviewService)
 *            → APROVAÇÃO humana (com ressalvas) ou REJEIÇÃO (com razão)
 *            → APLICAÇÃO (somente de proposta `approved`, patch íntegro)
 *
 * Garantias fail-closed:
 *   - id determinístico `brcp-<sha256(vertical|runId|patchSha256)[:vN]>`: a
 *     mesma proposta é idempotente; depois de estado terminal (applied/
 *     rejected), a nova proposta do mesmo patch é uma versão determinística;
 *   - proposta SEM trabalho real não existe: o merge em memória roda na
 *     criação e `sample_patch_without_analysis` aborta a proposta;
 *   - auto-aprovação é negada (`self_approval_denied`): quem propõe não aprova;
 *   - o reviewToken exige integridade HMAC, TTL, MESMO revisor e MESMO hash de
 *     patch; só o HASH do token é persistido (nunca o token em claro);
 *   - a aplicação recompute o sha256 do patch persistido — adulteração entre
 *     aprovação e aplicação é `patch_tampered`;
 *   - a avaliação (before/after do engine de suficiência) é computada por merge
 *     EM MEMÓRIA — nada é escrito antes da aprovação;
 *   - `recommendation` é ADVISORY: a decisão é humana, sempre.
 *
 * Auditoria: o serviço recebe `logAction(event, details)` injetado pelo módulo
 * de rotas (que liga no audit real); sem ele, o logger registra a transição.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const getBenchmarkResearchChangeProposalModel = require('../../db/models/BenchmarkResearchChangeProposal');
const { resolveSigningKey } = require('../../../lib/replayIntegrity');
const {
  mergeSamplePatch,
  applySamplePatch,
  SAMPLES_DIR,
} = require('./benchmarkSampleRegistry');
const { evaluateSampleSufficiency } = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const SUFFICIENCY_POLICY = require('../../../config/benchmark-sufficiency-policy.json');

const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

const PROPOSAL_STATUSES = Object.freeze(['proposed', 'approved', 'rejected', 'applied']);
const TERMINAL_STATUSES = new Set(['applied', 'rejected']);

const ERROR_CODES = Object.freeze({
  NOT_FOUND: 'proposal_not_found',
  INVALID_STATUS: 'proposal_invalid_status',
  TOKEN_REQUIRED: 'review_token_required',
  TOKEN_INVALID: 'review_token_invalid',
  TOKEN_EXPIRED: 'review_token_expired',
  TOKEN_REVIEWER_MISMATCH: 'review_token_reviewer_mismatch',
  SELF_APPROVAL: 'self_approval_denied',
  PATCH_TAMPERED: 'patch_tampered',
  REASON_REQUIRED: 'reason_required',
  RUN_MISMATCH: 'proposal_run_mismatch',
  SAMPLE_NOT_FOUND: 'sample_not_found',
  ACTOR_REQUIRED: 'actor_required',
});

function proposalError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Ordenação estável (mesma disciplina do journeyReviewService). */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashPatch(patch) {
  return sha256(JSON.stringify(stable(patch || {})));
}

/**
 * Id determinístico da proposta. A versão entra no hash: depois de um estado
 * terminal, a MESMA proposta (mesmo vertical/run/patch) gera `v2`, `v3`… —
 * história preservada, nunca overwrite de uma decisão já tomada.
 */
function proposalIdFor({ vertical, runId, patchSha256, version = 1 }) {
  const input = `${vertical}|${runId || 'no-run'}|${patchSha256}${version > 1 ? `|v${version}` : ''}`;
  return `brcp-${sha256(input).slice(0, 48)}`;
}

function defaultReadSample(vertical) {
  const samplePath = path.join(SAMPLES_DIR, `${vertical}.json`);
  if (!fs.existsSync(samplePath)) return null;
  return { samplePath, sample: JSON.parse(fs.readFileSync(samplePath, 'utf8')) };
}

function defaultEvaluateSample(sample) {
  return evaluateSampleSufficiency({ sample, policy: SUFFICIENCY_POLICY });
}

function gateStatuses(evaluation) {
  const gates = evaluation && evaluation.gates ? evaluation.gates : {};
  return Object.fromEntries(Object.entries(gates).map(([name, gate]) => [name, gate?.status || 'UNKNOWN']));
}

function countNovelty(novelty) {
  if (!novelty || typeof novelty !== 'object') return 0;
  return Object.values(novelty).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
}

/**
 * Documento de AVALIAÇÃO da proposta — derivado SÓ de dados reais (patch
 * persistido + sample versionado + engine de suficiência). Nada aqui é
 * inventado: se um número não existe, o campo diz que não existe.
 */
function buildEvaluation({
  vertical,
  runId,
  patch,
  priorSample,
  nextSamplePreview,
  evaluateSample = defaultEvaluateSample,
  generatedAt = new Date().toISOString(),
}) {
  const priorBenchmarks = new Map(
    (Array.isArray(priorSample?.benchmarks) ? priorSample.benchmarks : []).map((benchmark) => [benchmark.id, benchmark]),
  );
  const patchBenchmarks = Array.isArray(patch?.benchmarks) ? patch.benchmarks : [];
  const analyzed = patchBenchmarks.filter((benchmark) => isNonEmptyString(benchmark?.analyzedAt));

  // Diff REAL do patch contra o sample versionado.
  const whatChanges = [];
  for (const benchmark of analyzed) {
    if (priorBenchmarks.has(benchmark.id)) {
      whatChanges.push({
        type: 'update',
        benchmarkId: benchmark.id,
        reason: `benchmark analisado (${benchmark.researchVersion || patch.researchVersion || 'pesquisa'}): `
          + `${(Array.isArray(benchmark.findingsInventory) ? benchmark.findingsInventory : []).length} achados verificados, `
          + `${countNovelty(benchmark.novelty)} itens de novidade`,
      });
    }
  }
  const priorEvidenceIds = new Set(
    (Array.isArray(priorSample?.evidence) ? priorSample.evidence : []).map((entry) => entry.id),
  );
  for (const entry of (Array.isArray(patch?.evidence) ? patch.evidence : [])) {
    if (entry && isNonEmptyString(entry.id) && !priorEvidenceIds.has(entry.id)) {
      whatChanges.push({
        type: 'add',
        benchmarkId: entry.benchmarkId || null,
        reason: `evidência ${entry.id} registrada (${entry.evidenceRef || 'sem ref'})`,
      });
    }
  }

  // Suficiência ANTES/DEPOIS — o "depois" é o merge EM MEMÓRIA (nunca escrito).
  const before = gateStatuses(evaluateSample(priorSample));
  const after = gateStatuses(evaluateSample(nextSamplePreview));
  const gatesFlipping = Object.keys(after)
    .filter((gate) => before[gate] !== after[gate])
    .map((gate) => ({ gate, from: before[gate] || 'UNKNOWN', to: after[gate] }));

  const pros = [];
  const cons = [];
  const risks = [];

  for (const flip of gatesFlipping.filter((entry) => entry.from !== 'PASS' && entry.to === 'PASS')) {
    pros.push(`gate ${flip.gate} passa a PASS com a amostra atualizada`);
  }
  const noveltyTotals = {
    capabilities: analyzed.reduce((total, b) => total + (b.novelty?.newCapabilities?.length || 0), 0),
    journeys: analyzed.reduce((total, b) => total + (b.novelty?.newJourneys?.length || 0), 0),
    businessRules: analyzed.reduce((total, b) => total + (b.novelty?.newBusinessRules?.length || 0), 0),
  };
  if (noveltyTotals.capabilities > 0) pros.push(`${noveltyTotals.capabilities} capabilities novas verificadas entram na amostra`);
  if (noveltyTotals.journeys > 0) pros.push(`${noveltyTotals.journeys} jornadas novas verificadas entram na amostra`);
  if (noveltyTotals.businessRules > 0) pros.push(`${noveltyTotals.businessRules} regras de negócio novas verificadas entram na amostra`);
  const verifiedSources = analyzed.reduce((total, b) => total
    + (Array.isArray(b.sources) ? b.sources : []).filter((source) => source.verified === true).length, 0);
  if (verifiedSources > 0) pros.push(`${verifiedSources} fontes verificadas reforçam a trilha de evidência`);
  if (analyzed.length > 0) pros.push(`${analyzed.length} benchmark(s) com análise documentada passam a contar para a cobertura do arquétipo`);

  for (const flip of gatesFlipping.filter((entry) => entry.from === 'PASS' && entry.to !== 'PASS')) {
    cons.push(`gate ${flip.gate} deixa de PASS (${flip.from} → ${flip.to})`);
  }
  for (const benchmark of analyzed) {
    const findingsCount = Array.isArray(benchmark.findingsInventory) ? benchmark.findingsInventory.length : 0;
    if (findingsCount === 0) {
      cons.push(`benchmark ${benchmark.id} analisado sem achados verificados — inventário permanece vazio`);
    }
    if (countNovelty(benchmark.novelty) === 0) {
      risks.push(`benchmark ${benchmark.id} com novidade zero — peso morto na amostra`);
    }
    if (Number.isFinite(benchmark.unresolvedSemanticCandidates) && benchmark.unresolvedSemanticCandidates > 0) {
      risks.push(`benchmark ${benchmark.id}: ${benchmark.unresolvedSemanticCandidates} candidato(s) semântico(s) ainda não classificado(s)`);
    }
  }
  const unmatched = analyzed.filter((benchmark) => !priorBenchmarks.has(benchmark.id));
  for (const benchmark of unmatched) {
    risks.push(`benchmark ${benchmark.id} do patch não existe no sample atual — não será aplicado`);
  }
  const unverifiedSources = analyzed.flatMap((benchmark) => (Array.isArray(benchmark.sources) ? benchmark.sources : [])
    .filter((source) => source.verified !== true)
    .map((source) => ({ benchmarkId: benchmark.id, url: source.url })));
  for (const source of unverifiedSources) {
    risks.push(`fonte sem documentação oficial verificada: ${source.url} (${source.benchmarkId})`);
  }

  const regressions = gatesFlipping.filter((entry) => entry.from === 'PASS' && entry.to !== 'PASS');
  const recommendation = regressions.length > 0
    ? {
      verdict: 'not_recommended',
      reasons: regressions.map((flip) => `gate ${flip.gate} regride (${flip.from} → ${flip.to})`),
    }
    : (cons.length > 0 || risks.length > 0
      ? { verdict: 'caution', reasons: [...cons, ...risks] }
      : { verdict: 'recommended', reasons: pros.length > 0 ? pros : ['mudança neutra e íntegra'] });

  const practicalAssessment = [
    `Vertical: ${vertical}. Run: ${runId || 'nenhum (patch sem run resolvido)'}.`,
    `O patch cobre ${analyzed.length} benchmark(s) analisado(s) de ${priorBenchmarks.size} na amostra; `
      + `${whatChanges.filter((change) => change.type === 'add').length} evidência(s) nova(s).`,
    `Gates de suficiência: ${gatesFlipping.length} mudança(s) de estado `
      + `(${gatesFlipping.filter((flip) => flip.to === 'PASS').length} melhoras, ${regressions.length} regressões).`,
    `Novidade medida: ${noveltyTotals.capabilities} capabilities, ${noveltyTotals.journeys} jornadas, `
      + `${noveltyTotals.businessRules} regras de negócio.`,
    'A recomendação é advisory: a decisão de aplicar é humana e exige aprovação com ressalvas registradas.',
  ].join('\n');

  return {
    context: {
      vertical,
      runId: runId || null,
      generatedAt,
      benchmarksInSample: priorBenchmarks.size,
      sourcesResearched: analyzed.reduce((total, b) => total + (Array.isArray(b.sources) ? b.sources.length : 0), 0),
      evidenceCount: Array.isArray(patch?.evidence) ? patch.evidence.length : 0,
      findingsByKind: noveltyTotals,
      noveltyByClassification: {
        required: analyzed.reduce((total, b) => total
          + (b.novelty?.newRequiredCapabilities?.length || 0)
          + (b.novelty?.newRequiredJourneys?.length || 0)
          + (b.novelty?.newRequiredBusinessRules?.length || 0), 0),
        critical: analyzed.reduce((total, b) => total
          + (b.novelty?.newCriticalCapabilities?.length || 0)
          + (b.novelty?.newCriticalJourneys?.length || 0)
          + (b.novelty?.newCriticalBusinessRules?.length || 0), 0),
      },
    },
    whatChanges,
    sufficiency: { before, after, gatesFlipping },
    pros,
    cons,
    risks,
    practicalAssessment,
    recommendation,
    nonGoals: [
      `Esta proposta altera apenas a amostra de benchmarks (config/benchmarks/${vertical}.json). `
        + 'Não implementa capabilities, não altera código de produto.',
    ],
  };
}

function toProposal(row) {
  if (!row) return null;
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  return {
    id: plain.id,
    vertical: plain.vertical,
    runId: plain.run_id || null,
    patch: plain.patch,
    patchSha256: plain.patch_sha256,
    evaluation: plain.evaluation,
    status: plain.status,
    caveats: Array.isArray(plain.caveats) ? plain.caveats : [],
    decisionReason: plain.decision_reason || null,
    proposedBy: plain.proposed_by,
    reviewedBy: plain.reviewed_by || null,
    appliedBy: plain.applied_by || null,
    reviewTokenExpiresAt: plain.review_token_expires_at ? new Date(plain.review_token_expires_at).toISOString() : null,
    proposedAt: plain.proposed_at ? new Date(plain.proposed_at).toISOString() : null,
    reviewedAt: plain.reviewed_at ? new Date(plain.reviewed_at).toISOString() : null,
    appliedAt: plain.applied_at ? new Date(plain.applied_at).toISOString() : null,
    createdAt: plain.created_at ? new Date(plain.created_at).toISOString() : null,
    updatedAt: plain.updated_at ? new Date(plain.updated_at).toISOString() : null,
  };
}

/**
 * @param {object} deps
 * @param {Function} deps.buildPatch  async ({ vertical, priorSample }) => { patch, runId } — obrigatório
 * @param {Function} [deps.readSample]     (vertical) => { samplePath, sample } | null
 * @param {Function} [deps.evaluateSample] (sample) => avaliação do engine
 * @param {Function} [deps.applyPatch]     default: applySamplePatch real
 * @param {Buffer|string} [deps.signingKey] chave HMAC (default: resolveSigningKey)
 * @param {Function} [deps.now]
 * @param {Function} [deps.logAction] (event, details) — auditoria real injetada
 * @param {object} [deps.logger]
 */
function createBenchmarkChangeProposalService({
  buildPatch,
  readSample = defaultReadSample,
  evaluateSample = defaultEvaluateSample,
  applyPatch = applySamplePatch,
  signingKey = null,
  now = () => new Date(),
  logAction = null,
  logger = null,
} = {}) {
  if (typeof buildPatch !== 'function') {
    throw new Error('benchmark_change_proposal_patch_builder_required');
  }
  const log = logger || { info() {}, warn() {}, error() {}, debug() {} };

  function audit(event, details) {
    if (typeof logAction === 'function') {
      try {
        logAction(event, details);
        return;
      } catch (error) {
        log.warn('[benchmark-change-proposal] auditoria falhou', { event, error: error.message });
      }
    }
    log.info(`[benchmark-change-proposal] ${event}`, details);
  }

  function reviewSigningKey() {
    if (signingKey) return Buffer.isBuffer(signingKey) ? signingKey : Buffer.from(String(signingKey), 'utf8');
    return resolveSigningKey(process.env.BENCHMARK_PROPOSAL_SIGNING_KEY || null);
  }

  function createReviewToken(claims) {
    const encoded = Buffer.from(JSON.stringify(stable(claims)), 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', reviewSigningKey()).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  function verifyReviewToken(token) {
    const [encoded, providedSignature, extra] = String(token || '').split('.');
    if (!encoded || !providedSignature || extra !== undefined) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken inválido');
    }
    const expectedSignature = crypto.createHmac('sha256', reviewSigningKey()).update(encoded).digest('base64url');
    const provided = Buffer.from(providedSignature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken inválido');
    }
    let claims;
    try {
      claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch (_) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken inválido');
    }
    if (!Number.isFinite(claims.expiresAt) || now().getTime() > claims.expiresAt) {
      throw proposalError(ERROR_CODES.TOKEN_EXPIRED, 'reviewToken expirado; inicie uma nova revisão');
    }
    return claims;
  }

  async function requireProposal(proposalId) {
    const Model = getBenchmarkResearchChangeProposalModel();
    const row = await Model.findByPk(String(proposalId || ''));
    if (!row) throw proposalError(ERROR_CODES.NOT_FOUND, `proposta ${proposalId} não encontrada`);
    return row;
  }

  /**
   * Cria (ou devolve, idempotentemente) a proposta do patch atual do run.
   * NADA é escrito no sample: o merge roda em memória só para a avaliação.
   */
  async function createProposal({ vertical, runId = null, actor } = {}) {
    const cleanVertical = String(vertical || '').trim();
    if (!cleanVertical) throw proposalError(ERROR_CODES.NOT_FOUND, 'vertical é obrigatória');
    if (!isNonEmptyString(actor)) throw proposalError(ERROR_CODES.ACTOR_REQUIRED, 'ator autenticado é obrigatório');

    const loaded = readSample(cleanVertical);
    if (!loaded) throw proposalError(ERROR_CODES.SAMPLE_NOT_FOUND, `sample ausente para ${cleanVertical}`);

    const built = await buildPatch({ vertical: cleanVertical, priorSample: loaded.sample });
    const patch = built && built.patch;
    const resolvedRunId = built && built.runId ? String(built.runId) : null;
    if (!patch || !Array.isArray(patch.benchmarks)) {
      throw proposalError(ERROR_CODES.NOT_FOUND, 'o run não produziu patch para propor');
    }
    if (isNonEmptyString(runId) && runId !== resolvedRunId) {
      throw proposalError(ERROR_CODES.RUN_MISMATCH, `runId ${runId} não é o run atual da vertical (${resolvedRunId || 'nenhum'})`);
    }

    // Merge EM MEMÓRIA: proposta sem trabalho real aborta aqui
    // (`sample_patch_without_analysis` do registry), antes de qualquer escrita.
    const preview = mergeSamplePatch(loaded.sample, patch);
    const patchSha256 = hashPatch(patch);
    const evaluation = buildEvaluation({
      vertical: cleanVertical,
      runId: resolvedRunId,
      patch,
      priorSample: loaded.sample,
      nextSamplePreview: preview.sample,
      evaluateSample,
      generatedAt: now().toISOString(),
    });

    const Model = getBenchmarkResearchChangeProposalModel();
    for (let version = 1; version <= 100; version += 1) {
      const id = proposalIdFor({ vertical: cleanVertical, runId: resolvedRunId, patchSha256, version });
      const existing = await Model.findByPk(id);
      if (!existing) {
        const row = await Model.create({
          id,
          vertical: cleanVertical,
          run_id: resolvedRunId,
          patch,
          patch_sha256: patchSha256,
          evaluation,
          status: 'proposed',
          caveats: [],
          proposed_by: actor,
          proposed_at: now(),
        });
        audit('benchmark_research.proposal_created', { proposalId: id, vertical: cleanVertical, runId: resolvedRunId, patchSha256 });
        return { proposal: toProposal(row), created: true };
      }
      if (!TERMINAL_STATUSES.has(existing.status)) {
        // Idempotente: a MESMA proposta ainda aberta é devolvida, nunca duplicada.
        return { proposal: toProposal(existing), created: false };
      }
      // Estado terminal: a próxima versão determinística carrega a história.
    }
    throw proposalError(ERROR_CODES.INVALID_STATUS, 'limite de versões da proposta atingido');
  }

  /** Emite o token de revisão (TTL 30 min). Persiste apenas o HASH do token. */
  async function startReview({ proposalId, actor } = {}) {
    if (!isNonEmptyString(actor)) throw proposalError(ERROR_CODES.ACTOR_REQUIRED, 'ator autenticado é obrigatório');
    const row = await requireProposal(proposalId);
    if (row.status !== 'proposed') {
      throw proposalError(ERROR_CODES.INVALID_STATUS, `proposta está ${row.status}; revisão exige status proposed`);
    }
    const issuedAt = now().getTime();
    const claims = {
      proposalId: row.id,
      patchSha256: row.patch_sha256,
      reviewedBy: actor,
      issuedAt,
      expiresAt: issuedAt + REVIEW_TOKEN_TTL_MS,
    };
    const reviewToken = createReviewToken(claims);
    await row.update({
      review_token_sha256: sha256(reviewToken),
      review_token_expires_at: new Date(claims.expiresAt),
    });
    audit('benchmark_research.review_started', { proposalId: row.id, reviewedBy: actor });
    return { reviewToken, expiresAt: new Date(claims.expiresAt).toISOString() };
  }

  /** Aprovação humana — fail-closed em TODAS as dimensões do binding. */
  async function approveProposal({ proposalId, actor, reviewToken, caveats = [], reason = null } = {}) {
    if (!isNonEmptyString(actor)) throw proposalError(ERROR_CODES.ACTOR_REQUIRED, 'ator autenticado é obrigatório');
    const row = await requireProposal(proposalId);
    if (row.status !== 'proposed') {
      throw proposalError(ERROR_CODES.INVALID_STATUS, `proposta está ${row.status}; aprovação exige status proposed`);
    }
    if (row.proposed_by === actor) {
      throw proposalError(ERROR_CODES.SELF_APPROVAL, 'quem propôs não pode aprovar a própria proposta');
    }
    if (!isNonEmptyString(reviewToken)) {
      throw proposalError(ERROR_CODES.TOKEN_REQUIRED, 'reviewToken é obrigatório para aprovar');
    }
    const claims = verifyReviewToken(reviewToken);
    if (claims.proposalId !== row.id) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken não pertence a esta proposta');
    }
    if (claims.patchSha256 !== row.patch_sha256) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken não corresponde ao patch da proposta');
    }
    if (!claims.reviewedBy || claims.reviewedBy !== actor) {
      throw proposalError(ERROR_CODES.TOKEN_REVIEWER_MISMATCH, 'reviewToken não pertence ao revisor autenticado');
    }
    if (!isNonEmptyString(row.review_token_sha256) || row.review_token_sha256 !== sha256(reviewToken)) {
      throw proposalError(ERROR_CODES.TOKEN_INVALID, 'reviewToken não é o emitido na revisão atual desta proposta');
    }
    if (row.review_token_expires_at && now().getTime() > new Date(row.review_token_expires_at).getTime()) {
      throw proposalError(ERROR_CODES.TOKEN_EXPIRED, 'reviewToken expirado; inicie uma nova revisão');
    }

    await row.update({
      status: 'approved',
      caveats: (Array.isArray(caveats) ? caveats : []).filter(isNonEmptyString).map((caveat) => caveat.trim()),
      decision_reason: isNonEmptyString(reason) ? reason.trim() : null,
      reviewed_by: actor,
      reviewed_at: now(),
    });
    audit('benchmark_research.proposal_approved', {
      proposalId: row.id,
      reviewedBy: actor,
      caveats: Array.isArray(caveats) ? caveats.length : 0,
    });
    return { proposal: toProposal(await requireProposal(row.id)) };
  }

  /** Rejeição humana — razão obrigatória (decisão sem razão não é auditável). */
  async function rejectProposal({ proposalId, actor, reason } = {}) {
    if (!isNonEmptyString(actor)) throw proposalError(ERROR_CODES.ACTOR_REQUIRED, 'ator autenticado é obrigatório');
    if (!isNonEmptyString(reason)) {
      throw proposalError(ERROR_CODES.REASON_REQUIRED, 'a rejeição exige uma razão documentada');
    }
    const row = await requireProposal(proposalId);
    if (row.status !== 'proposed') {
      throw proposalError(ERROR_CODES.INVALID_STATUS, `proposta está ${row.status}; rejeição exige status proposed`);
    }
    await row.update({
      status: 'rejected',
      decision_reason: reason.trim(),
      reviewed_by: actor,
      reviewed_at: now(),
    });
    audit('benchmark_research.proposal_rejected', { proposalId: row.id, reviewedBy: actor });
    return { proposal: toProposal(await requireProposal(row.id)) };
  }

  /**
   * Aplica UMA proposta APROVADA ao sample versionado. O patch persistido é
   * re-hasheado antes da escrita — adulteração entre aprovação e aplicação
   * aborta com `patch_tampered`.
   */
  async function applyProposal({ proposalId, actor } = {}) {
    if (!isNonEmptyString(actor)) throw proposalError(ERROR_CODES.ACTOR_REQUIRED, 'ator autenticado é obrigatório');
    const row = await requireProposal(proposalId);
    if (row.status !== 'approved') {
      throw proposalError(ERROR_CODES.INVALID_STATUS, `proposta está ${row.status}; aplicação exige status approved`);
    }
    if (hashPatch(row.patch) !== row.patch_sha256) {
      throw proposalError(ERROR_CODES.PATCH_TAMPERED, 'o patch persistido diverge do hash aprovado');
    }
    const loaded = readSample(row.vertical);
    if (!loaded) throw proposalError(ERROR_CODES.SAMPLE_NOT_FOUND, `sample ausente para ${row.vertical}`);

    const applyResult = applyPatch({
      patch: row.patch,
      samplePath: loaded.samplePath,
      validate: (candidate) => {
        const evaluation = evaluateSample(candidate);
        if (!evaluation || !evaluation.status) {
          throw new Error('engine não produziu avaliação para o sample candidato');
        }
      },
    });

    await row.update({
      status: 'applied',
      applied_by: actor,
      applied_at: now(),
    });
    audit('benchmark_research.proposal_applied', {
      proposalId: row.id,
      appliedBy: actor,
      applied: applyResult.applied,
    });
    return { proposal: toProposal(await requireProposal(row.id)), applyResult };
  }

  async function listProposals({ vertical = null, status = null } = {}) {
    const Model = getBenchmarkResearchChangeProposalModel();
    const where = {};
    if (isNonEmptyString(vertical)) where.vertical = vertical.trim();
    if (isNonEmptyString(status)) {
      if (!PROPOSAL_STATUSES.includes(status.trim())) {
        throw proposalError(ERROR_CODES.INVALID_STATUS, `status desconhecido: ${status}`);
      }
      where.status = status.trim();
    }
    const rows = await Model.findAll({ where, order: [['proposed_at', 'DESC']], limit: 100 });
    return rows.map(toProposal);
  }

  async function getProposal(proposalId) {
    const Model = getBenchmarkResearchChangeProposalModel();
    return toProposal(await Model.findByPk(String(proposalId || '')));
  }

  return {
    createProposal,
    startReview,
    approveProposal,
    rejectProposal,
    applyProposal,
    listProposals,
    getProposal,
  };
}

module.exports = {
  REVIEW_TOKEN_TTL_MS,
  PROPOSAL_STATUSES,
  PROPOSAL_ERROR_CODES: ERROR_CODES,
  buildEvaluation,
  hashPatch,
  proposalIdFor,
  createBenchmarkChangeProposalService,
};
