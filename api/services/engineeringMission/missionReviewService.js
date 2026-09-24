'use strict';

/**
 * api/services/engineeringMission/missionReviewService.js
 *
 * Executa Meta Review (§23) e Adversarial Review (§24) sobre os ARTEFATOS REAIS da missão —
 * MissionSpec, aprovações, versões, EngineeringTask, tentativas (patches), execuções de teste,
 * reviews do Router, evidência de gates e o CONTEÚDO EM DISCO dos arquivos tocados.
 *
 * Duas regras de honestidade:
 *   1. o bundle é montado a partir do que existe persistido/em disco — nada é inferido de memória;
 *   2. gates são derivados com evidência explícita da fonte (`task.status`, `testRuns`, `reviews`),
 *      porque o Router só chega a GREEN depois de REGRESSION+REVIEW+GOVERNANCE — a fonte fica
 *      registrada no finding, nunca implícita.
 *
 * Nada aqui decide sozinho que existe GREEN: o resultado é FINDING. Quem recusa GREEN é
 * `missionOrchestratorService.refreshMissionState` — e este serviço o invoca após persistir a
 * revisão, para que uma revisão rodada DEPOIS de um GREEN já concedido também o derrube.
 */

const fs = require('fs');
const path = require('path');

const { runMetaReview, META_REVIEW_ENGINE_VERSION, REQUIRED_GATES_FOR_GREEN } = require('../../../engine/engineeringMission/metaReview');
const { evaluateAdversarialCoverage, ADVERSARIAL_REVIEW_ENGINE_VERSION } = require('../../../engine/engineeringMission/adversarialReview');
const { parseUnifiedDiff } = require('../../../engine/engineeringMission/diffAnalysis');
const missionStore = require('./missionStoreService');
const compiler = require('./missionCompilerService');
const logger = require('../../utils/logger');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MAX_FILE_BYTES = 512 * 1024;
const READABLE_EXT = /\.(js|cjs|mjs|jsx|json)$/;

function models() {
  const index = require('../../db/models');
  return {
    Review: index.EngineeringMissionReview(),
    Task: index.EngineeringTask(),
    Attempt: index.EngineeringAttempt(),
    TestRun: index.EngineeringTestRun(),
    ReviewRow: index.EngineeringReview(),
    Regression: index.EngineeringRegressionRun(),
  };
}

function toPlain(row) {
  return row && row.get ? row.get({ plain: true }) : row;
}

function readFileIfInsideRepo(relPath) {
  if (!relPath || !READABLE_EXT.test(relPath)) return null;
  const abs = path.resolve(REPO_ROOT, relPath);
  if (!abs.startsWith(REPO_ROOT)) return null; // nunca sai da árvore do repositório
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch (_) {
    return null;
  }
}

/** Gates derivados de evidência REAL, com a fonte declarada em cada um. */
function deriveGates({ task, testRuns, reviews, regressionRuns }) {
  const testsAllPass = testRuns.length > 0 && testRuns.every((t) => t.status === 'PASS' && t.exit_code === 0);
  const approvedReview = reviews.find((r) => r.decision === 'APPROVE');
  const greenAttestation = task && task.status === 'GREEN';
  const regressionPass = regressionRuns.length > 0 && regressionRuns.every((r) => r.status === 'PASS');

  return [
    {
      id: 'unit',
      status: testsAllPass || greenAttestation ? 'PASS' : 'MISSING',
      evidence: testsAllPass
        ? { source: 'engineering_test_runs', commands: testRuns.map((t) => t.command), allExitCodeZero: true }
        : (greenAttestation ? { source: 'task.status=GREEN', note: 'o Router só atesta GREEN após TESTING real' } : { source: 'engineering_test_runs', count: testRuns.length }),
    },
    {
      id: 'integration',
      status: testsAllPass || greenAttestation ? 'PASS' : 'MISSING',
      evidence: { source: testsAllPass ? 'engineering_test_runs' : 'task.status=GREEN', commands: testRuns.map((t) => t.command) },
    },
    {
      id: 'review',
      status: approvedReview || greenAttestation ? 'PASS' : 'MISSING',
      evidence: approvedReview
        ? { source: 'engineering_reviews', reviewerProvider: approvedReview.reviewer_provider, independentOfCoder: approvedReview.independent_of_coder }
        : { source: 'task.status=GREEN' },
    },
    {
      id: 'regression',
      status: regressionPass || greenAttestation ? 'PASS' : 'MISSING',
      evidence: regressionPass
        ? { source: 'engineering_regression_runs', count: regressionRuns.length }
        : { source: 'task.status=GREEN', note: 'fase REGRESSION do Router precedeu a promoção' },
    },
    {
      id: 'governance',
      status: greenAttestation ? 'PASS' : 'MISSING',
      evidence: { source: 'task.status=GREEN', note: 'fase GOVERNANCE do Router aprovou a promoção' },
    },
  ];
}

/**
 * Monta o bundle de revisão a partir do estado REAL da missão.
 */
async function collectReviewBundle(missionId, { changedFiles = [] } = {}) {
  const detail = await compiler.getMissionDetail(missionId);
  if (!detail) return null;

  const current = await missionStore.getCurrentVersion(missionId);
  const m = models();

  let task = null;
  let attempts = [];
  let testRuns = [];
  let reviews = [];
  let regressionRuns = [];
  if (detail.linked_task_id) {
    const taskRow = await m.Task.findByPk(detail.linked_task_id);
    task = taskRow ? toPlain(taskRow) : null;
    const attemptRows = await m.Attempt.findAll({ where: { task_id: detail.linked_task_id }, order: [['attempt_number', 'ASC']] });
    attempts = attemptRows.map(toPlain);
    for (const attempt of attempts) {
      const tr = await m.TestRun.findAll({ where: { attempt_id: attempt.id } });
      testRuns.push(...tr.map(toPlain));
      const rev = await m.ReviewRow.findAll({ where: { attempt_id: attempt.id } });
      reviews.push(...rev.map(toPlain));
      const reg = await m.Regression.findAll({ where: { attempt_id: attempt.id } }).catch(() => []);
      regressionRuns.push(...reg.map(toPlain));
    }
  }

  // Arquivos tocados: extraídos dos patches REAIS das tentativas (o código que a missão produziu).
  const filesFromPatches = new Set();
  for (const attempt of attempts) {
    if (!attempt.patch_diff) continue;
    for (const file of parseUnifiedDiff(attempt.patch_diff).keys()) filesFromPatches.add(file);
  }
  const allChangedFiles = [...new Set([...filesFromPatches, ...changedFiles])];

  const fileContents = new Map();
  for (const file of allChangedFiles) {
    const content = readFileIfInsideRepo(file);
    if (content) fileContents.set(file, content);
  }

  const gates = deriveGates({ task, testRuns, reviews, regressionRuns });

  return {
    mission: {
      id: detail.id,
      originalMission: detail.original_mission,
      status: detail.status,
      displayStatus: detail.displayStatus,
      approvalState: detail.approval_state,
      approvalMode: detail.approval_mode,
      currentVersion: detail.current_version,
    },
    spec: current ? current.spec : null,
    approvals: detail.approvals.map((a) => ({
      state: a.state,
      specVersion: a.spec_version,
      specHash: a.spec_hash,
      mode: a.mode,
      policyId: a.policy_id,
      actor: a.actor,
      rulesEvaluated: a.rules_evaluated,
      blockers: a.blockers,
    })),
    versions: detail.versions.map((v) => ({ version: v.version, specHash: v.specHash, materiality: v.materiality, event: v.event })),
    task: task ? {
      id: task.id,
      status: task.status,
      taskType: task.task_type,
      risk: task.risk,
      acceptanceCriteria: task.acceptance_criteria,
      allowedPaths: task.allowed_paths,
      testCommands: task.test_commands,
      lastError: task.last_error,
    } : null,
    attempts: attempts.map((a) => ({
      attemptNumber: a.attempt_number,
      status: a.status,
      coderProvider: a.coder_provider,
      coderModel: a.coder_model,
      patchDiff: a.patch_diff,
      routingReasonCodes: a.routing_reason_codes,
      failureBundle: a.failure_bundle,
    })),
    testRuns: testRuns.map((t) => ({ command: t.command, status: t.status, exitCode: t.exit_code, stdoutExcerpt: t.stdout_excerpt, stderrExcerpt: t.stderr_excerpt })),
    reviews: reviews.map((r) => ({ decision: r.decision, independentOfCoder: r.independent_of_coder, findings: r.findings, reviewerProvider: r.reviewer_provider, reviewerModel: r.reviewer_model })),
    gates,
    claims: buildClaims({ detail, task, testRuns, reviews, gates }),
    changedFiles: allChangedFiles,
    fileContents,
    evidence: { regressionRuns: regressionRuns.length, derivedGatesSources: gates.map((g) => ({ id: g.id, source: g.evidence.source })) },
  };
}

/**
 * Afirmações de conclusão da missão — cada uma com a evidência que a sustenta. O Meta Reviewer
 * reprova (MR-14) qualquer afirmação sem evidência, então esta lista é deliberadamente factual.
 */
function buildClaims({ detail, task, testRuns, reviews, gates }) {
  const claims = [];
  if (task) {
    claims.push({ text: `EngineeringTask ${task.id} existe`, evidence: [{ type: 'engineering_tasks', id: task.id }] });
    claims.push({ text: `task.status = ${task.status}`, evidence: [{ type: 'engineering_tasks', field: 'status' }] });
  }
  if (detail.approval_state) claims.push({ text: `aprovação vigente = ${detail.approval_state}`, evidence: [{ type: 'engineering_mission_approvals', missionId: detail.id }] });
  if (testRuns.length > 0) claims.push({ text: `${testRuns.length} execução(ões) de teste registradas`, evidence: [{ type: 'engineering_test_runs', count: testRuns.length }] });
  if (reviews.length > 0) claims.push({ text: `${reviews.length} review(s) do Router registrada(s)`, evidence: [{ type: 'engineering_reviews', count: reviews.length }] });
  for (const gate of gates) {
    claims.push({ text: `gate ${gate.id} = ${gate.status}`, evidence: [gate.evidence] });
  }
  return claims;
}

async function persistReview({ missionId, missionVersion, specHash, result, actor, idempotencyKey = null }) {
  const { Review } = models();
  const payload = {
    mission_id: missionId,
    mission_version: missionVersion,
    spec_hash: specHash,
    kind: result.kind,
    status: result.status,
    blocks_green: result.blocksGreen === true,
    counts: result.counts || { total: result.total, covered: result.covered, uncovered: (result.uncovered || []).length },
    findings: result.findings || result.cases || [],
    summary: result.analysisSummary || { notAutomatable: (result.notAutomatable || []).length },
    engine_version: result.engineVersion,
    actor,
    idempotency_key: idempotencyKey,
  };
  try {
    const row = await Review.create(payload);
    return toPlain(row);
  } catch (err) {
    if (idempotencyKey && (err.name === 'SequelizeUniqueConstraintError' || /unique/i.test(err.message || ''))) {
      const existing = await Review.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return toPlain(existing);
    }
    const wrapped = new Error(`persistence_required: falha ao gravar review: ${err.message}`);
    wrapped.code = 'persistence_required';
    throw wrapped;
  }
}

/**
 * Roda as revisões de uma missão: META (código/artefatos), ADVERSARIAL (cobertura do catálogo de
 * ataques) ou AMBAS.
 *
 * @returns {Promise<{meta:Object|null, adversarial:Object|null, missionId:string, missionVersion:number}>}
 */
async function runReviews(missionId, { actor = null, kinds = ['META', 'ADVERSARIAL'], changedFiles = [], idempotencyKey = null } = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) throw Object.assign(new Error(`mission ${missionId} não encontrada`), { code: 'not_found' });

  const out = { missionId, missionVersion: mission.current_version, specHash: mission.current_spec_hash, meta: null, adversarial: null };

  if (kinds.includes('META')) {
    const bundle = await collectReviewBundle(missionId, { changedFiles });
    if (!bundle || !bundle.spec) {
      throw Object.assign(new Error('mission não possui MissionSpec corrente — enriqueça antes de revisar'), { code: 'MISSION_SPEC_NOT_APPROVED' });
    }
    const result = runMetaReview(bundle, { policy: { internalEngineeringPaths: ['api/services/engineeringMission/', 'api/services/engineeringRouter/', 'engine/engineeringMission/', 'engine/engineeringRouter/'] } });
    const row = await persistReview({
      missionId,
      missionVersion: mission.current_version,
      specHash: mission.current_spec_hash,
      result,
      actor,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:META` : null,
    });
    out.meta = { ...result, persistedId: row.id, persistedAt: row.created_at };
    logger.info('[missionReview] meta review executado', {
      missionId, status: result.status, blocksGreen: result.blocksGreen, blockers: result.counts.blockers,
    });
  }

  if (kinds.includes('ADVERSARIAL')) {
    const result = evaluateAdversarialCoverage(
      (relPath) => fs.existsSync(path.resolve(REPO_ROOT, relPath)),
      (relPath) => readFileIfInsideRepo(relPath) || '',
    );
    const row = await persistReview({
      missionId,
      missionVersion: mission.current_version,
      specHash: mission.current_spec_hash,
      result,
      actor,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:ADVERSARIAL` : null,
    });
    out.adversarial = { ...result, persistedId: row.id, persistedAt: row.created_at };
    logger.info('[missionReview] adversarial review executado', {
      missionId, status: result.status, uncovered: result.uncovered.length,
    });
  }

  // Enforcement de GREEN em AMBOS os sentidos. O orquestrador recusa GREEN quando a revisão da
  // versão corrente bloqueia — mas ele só é consultado quando o estado é RECALCULADO. Uma revisão
  // rodada DEPOIS de a missão já estar GREEN (ou seja: execução primeiro, revisão depois) deixava
  // a missão GREEN com um parecer bloqueante persistido — bypass do §23. Recalcular aqui fecha
  // esse vetor, independentemente de quem chamou a revisão (rota, resume ou teste).
  // Require preguiçoso: o orquestrador já depende deste serviço (§ ciclo de módulos).
  const anyBlocking = Boolean(out.meta?.blocksGreen || out.adversarial?.blocksGreen);
  const missionNow = await missionStore.getMission(missionId);
  if (anyBlocking || missionNow?.status === 'GREEN') {
    const orchestrator = require('./missionOrchestratorService');
    await orchestrator.refreshMissionState(missionId, { tenantId: mission.tenant_id || 'system' });
    out.missionStateReevaluated = true;
  } else {
    out.missionStateReevaluated = false;
  }

  return out;
}

async function getLatestReview(missionId, kind) {
  const { Review } = models();
  const row = await Review.findOne({ where: { mission_id: missionId, kind }, order: [['created_at', 'DESC']] });
  return row ? toPlain(row) : null;
}

async function listReviews(missionId) {
  const { Review } = models();
  const rows = await Review.findAll({ where: { mission_id: missionId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

/**
 * Consulta usada pelo orquestrador ANTES de permitir GREEN: existe review BLOQUEANTE para a versão
 * corrente? Uma review de versão anterior NÃO bloqueia a nova (a nova precisa da sua própria).
 */
async function getBlockingReview(missionId, missionVersion) {
  const { Review } = models();
  const row = await Review.findOne({
    where: { mission_id: missionId, mission_version: missionVersion, blocks_green: true },
    order: [['created_at', 'DESC']],
  });
  if (!row) return null;
  const plain = toPlain(row);
  const blockingFindings = (Array.isArray(plain.findings) ? plain.findings : [])
    .filter((f) => f && f.status === 'FAIL' && (f.severity === 'BLOCKER' || f.severity === 'REGRESSION') && f.blocksGreen !== false)
    .map((f) => ({ id: f.id, checkId: f.checkId, severity: f.severity, title: f.title }))
    .filter((f) => f.id);
  // A review ADVERSARIAL registra `uncovered` (ataques sem teste) em vez de `findings`.
  const uncovered = plain.kind === 'ADVERSARIAL'
    ? (Array.isArray(plain.findings) ? plain.findings.filter((c) => c && c.status === 'UNCOVERED') : [])
      .map((c) => ({ id: c.id, checkId: 'ADVERSARIAL_CASE_UNCOVERED', severity: c.severity, title: c.attack }))
    : [];
  return {
    id: plain.id,
    kind: plain.kind,
    status: plain.status,
    engineVersion: plain.engine_version,
    createdAt: plain.created_at,
    blockingFindings: [...blockingFindings, ...uncovered],
  };
}

module.exports = {
  REPO_ROOT,
  REQUIRED_GATES_FOR_GREEN,
  META_REVIEW_ENGINE_VERSION,
  ADVERSARIAL_REVIEW_ENGINE_VERSION,
  deriveGates,
  buildClaims,
  collectReviewBundle,
  runReviews,
  getLatestReview,
  listReviews,
  getBlockingReview,
};
