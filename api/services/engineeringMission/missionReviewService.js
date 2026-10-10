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
const { summarizeTestCoverage, CATEGORIES: TEST_CATEGORIES } = require('../../../engine/engineeringMission/testSuiteClassifier');
const { parseUnifiedDiff } = require('../../../engine/engineeringMission/diffAnalysis');
const missionStore = require('./missionStoreService');
const compiler = require('./missionCompilerService');
const logger = require('../../utils/logger');

/** Tenant de plataforma — mesmo padrão de `DEFAULT_TENANT_ID` em engineeringRouter/*. */
const PLATFORM_TENANT_ID = 'system';

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

/**
 * Um objeto JSONB persistido conta como evidência somente se tiver conteúdo real. `{}`, `null` e
 * `undefined` NÃO são evidência — são ausência dela.
 */
function hasEvidenceRecord(value) {
  return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
}

/**
 * Gates da missão derivados de evidência REAL e VERIFICÁVEL.
 *
 * DEFEITO MEDIDO (2026-10-08): `task.status === 'GREEN'` era tratado como atestado suficiente para
 * os CINCO gates virarem `PASS`. Consequência: qualquer escrita de `status='GREEN'` na tabela
 * `engineering_tasks` — por bug, migração, script de manutenção ou manipulação — transformava a
 * revisão da missão em cinco PASS e liberava o handover. A "revisão independente" não era
 * independente do próprio executor: ela confiava no atestado dele em vez de conferir a evidência.
 *
 * AGORA: cada gate é derivado da evidência que o Router PERSISTE ao avançar de fase
 * (`engineering_test_runs`, `engineering_reviews`, `engineering_regression_runs` e os campos
 * `regression_evidence` / `governance_evidence` / `promotion_status` da tentativa). O atestado de
 * `task.status` permanece apenas como rótulo AUDITÁVEL (`verification: 'ATTESTED'`) e NÃO produz
 * `PASS` — como o Meta Reviewer exige `status === 'PASS'` em MR-06, um GREEN sem evidência de fase
 * passa a ser BLOQUEADO em vez de promovido.
 *
 * @returns {Array<{id:string,status:string,verification:string,evidence:Object}>}
 */
function deriveGates({ task, testRuns, reviews, regressionRuns, greenAttempt = null }) {
  const testsAllPass = testRuns.length > 0 && testRuns.every((t) => t.status === 'PASS' && t.exit_code === 0);
  // COBERTURA POR CATEGORIA (2026-10-10): a mesma condição alimenta `unit` e
  // `integration`, então é preciso DIZER que categoria a evidência cobre. Sem
  // isso, uma suíte genérica marcava as duas como PASS sem que ninguém pudesse
  // ver que não havia evidência de integração distinta.
  const coverage = summarizeTestCoverage(testRuns);
  const unitEvidence = coverage.byCategory[TEST_CATEGORIES.UNIT];
  const integrationEvidence = coverage.byCategory[TEST_CATEGORIES.INTEGRATION];
  const e2eEvidence = coverage.byCategory[TEST_CATEGORIES.E2E];
  const hasDistinctIntegration = coverage.hasIntegrationEvidence;

  // REVISÃO: qual APPROVE conta, e ele é independente DE FATO?
  //
  // DEFEITO MEDIDO (auditoria 2026-10-10): `reviews.find(r => r.decision === 'APPROVE')`
  // varria as revisões de TODAS as tentativas da task. Um APPROVE obtido numa
  // tentativa ANTERIOR (patch diferente, já substituído) satisfazia o gate da
  // tentativa corrente — aprovação de outro patch reaproveitada. Agora a revisão
  // precisa ser da tentativa que efetivamente avançou.
  const reviewAttemptId = greenAttempt && greenAttempt.id ? greenAttempt.id : null;
  const attemptReviews = reviewAttemptId
    ? reviews.filter((r) => r.attempt_id === reviewAttemptId)
    : reviews;
  const approvedReview = attemptReviews.find((r) => r.decision === 'APPROVE');

  // INDEPENDÊNCIA CONFERIDA, não apenas declarada: `independent_of_coder` é um
  // campo gravado pelo Router, e confiar só nele é confiar no atestado do próprio
  // executor (exatamente o defeito que este arquivo combate desde 2026-10-08).
  // Aqui o campo é cruzado com os DADOS: o provider do revisor precisa diferir do
  // provider do coder da tentativa aprovada. Quando a declaração contradiz os
  // dados, o gate NÃO aceita como PASS e nomeia o código.
  const coderProvider = String((greenAttempt && greenAttempt.coder_provider) || '').trim();
  const reviewerProvider = String((approvedReview && approvedReview.reviewer_provider) || '').trim();
  const providersDiffer = Boolean(coderProvider && reviewerProvider && coderProvider !== reviewerProvider);
  const declaredIndependent = Boolean(approvedReview && approvedReview.independent_of_coder === true);
  const independentContradicted = declaredIndependent && coderProvider !== '' && reviewerProvider !== '' && !providersDiffer;
  const reviewBacked = Boolean(approvedReview) && !independentContradicted;

  const regressionPass = regressionRuns.length > 0 && regressionRuns.every((r) => r.status === 'PASS');
  const greenAttestation = Boolean(task && task.status === 'GREEN');

  // Evidência por fase persistida pelo Router na tentativa que avançou (fonte INDEPENDENTE do
  // `task.status`). Ver `engineeringRouterService.advanceFromCodedAttempt`.
  const regressionEvidence = hasEvidenceRecord(greenAttempt && greenAttempt.regression_evidence)
    ? greenAttempt.regression_evidence : null;
  const governanceEvidence = hasEvidenceRecord(greenAttempt && greenAttempt.governance_evidence)
    ? greenAttempt.governance_evidence : null;
  const promotionEvidence = hasEvidenceRecord(greenAttempt && greenAttempt.promotion_evidence)
    ? greenAttempt.promotion_evidence : null;
  const promoted = Boolean(greenAttempt && greenAttempt.promotion_status === 'PROMOTED');

  const gate = (id, backed, evidence, attestedEvidence) => ({
    id,
    status: backed ? 'PASS' : (greenAttestation ? 'ATTESTED' : 'MISSING'),
    verification: backed ? 'EVIDENCE' : (greenAttestation ? 'ATTESTED' : 'MISSING'),
    evidence: backed
      ? evidence
      : {
        ...(greenAttestation
          ? {
            source: 'task.status=GREEN',
            note: 'atestado do executor — NÃO conta como evidência de execução',
            observed: attestedEvidence || null,
          }
          : (attestedEvidence || { source: 'ausente' })),
        // O motivo ESPECÍFICO da recusa não pode se perder no caminho de falha:
        // sem isto, um gate recusado por revisão contradita aparecia apenas como
        // "atestado do executor", e a causa real sumia do parecer.
        ...(evidence && typeof evidence === 'object' ? { diagnostic: evidence } : {}),
      },
  });

  return [
    gate(
      'unit',
      testsAllPass,
      {
        source: 'engineering_test_runs',
        commands: testRuns.map((t) => t.command),
        allExitCodeZero: true,
        classification: TEST_CATEGORIES.UNIT,
        executedUnitCommands: unitEvidence.commands,
        unitRuns: unitEvidence.passed,
      },
      { source: 'engineering_test_runs', count: testRuns.length, attestedBy: 'task.status' },
    ),
    gate(
      'integration',
      testsAllPass,
      {
        source: 'engineering_test_runs',
        commands: testRuns.map((t) => t.command),
        classification: hasDistinctIntegration ? TEST_CATEGORIES.INTEGRATION : TEST_CATEGORIES.UNKNOWN,
        hasDistinctIntegrationEvidence: hasDistinctIntegration,
        integrationCommands: [...integrationEvidence.commands, ...e2eEvidence.commands],
        unknownCommands: coverage.unknownCommands,
        // Não silencia a lacuna: quem lê o parecer vê que a categoria foi
        // satisfeita pela MESMA evidência genérica que satisfez `unit`.
        note: hasDistinctIntegration
          ? 'cobertura de integração executada nesta missão'
          : 'sem evidência de integração distinta: o gate combina com `unit` sobre a mesma evidência genérica (policyNote do testSuiteClassifier)',
      },
      { source: 'engineering_test_runs', count: testRuns.length, attestedBy: 'task.status' },
    ),
    gate(
      'review',
      reviewBacked,
      {
        source: 'engineering_reviews',
        reviewerProvider: approvedReview && approvedReview.reviewer_provider,
        coderProvider: coderProvider || null,
        independentOfCoder: declaredIndependent,
        providersDiffer,
        attemptId: reviewAttemptId,
        // Código explícito quando a independência afirmada é contradita pelos dados
        // — sem isso o gate diria apenas "review" sem dizer POR QUE recusou.
        code: independentContradicted ? 'INDEPENDENT_REVIEW_CONTRADICTED_BY_PROVIDER' : null,
        note: independentContradicted
          ? 'a revisão se declara independente mas o provider do revisor é o MESMO do coder'
          : (approvedReview ? 'APPROVE da tentativa que avançou' : 'nenhum APPROVE na tentativa que avançou'),
      },
      { source: 'engineering_reviews', count: attemptReviews.length, attestedBy: 'task.status' },
    ),
    gate(
      'regression',
      regressionPass || Boolean(regressionEvidence),
      regressionPass
        ? { source: 'engineering_regression_runs', count: regressionRuns.length }
        : { source: 'engineering_attempts.regression_evidence', attemptId: greenAttempt && greenAttempt.id },
      { source: 'engineering_attempts.regression_evidence', present: false, attestedBy: 'task.status' },
    ),
    gate(
      'governance',
      Boolean(governanceEvidence),
      { source: 'engineering_attempts.governance_evidence', attemptId: greenAttempt && greenAttempt.id },
      { source: 'engineering_attempts.governance_evidence', present: false, attestedBy: 'task.status' },
    ),
    gate(
      'promotion',
      promoted,
      { source: 'engineering_attempts.promotion_status', status: 'PROMOTED', attemptId: greenAttempt && greenAttempt.id, evidence: promotionEvidence },
      { source: 'engineering_attempts.promotion_status', status: greenAttempt && greenAttempt.promotion_status, attestedBy: 'task.status' },
    ),
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

  // Tentativa que efetivamente AVANÇOU (é dela que sai a evidência por fase). Preferimos a
  // tentativa com promoção/evidência persistida; sem nenhuma, a última tentativa registrada.
  const greenAttempt = [...attempts].reverse().find((a) => (
    a.promotion_status === 'PROMOTED'
    || hasEvidenceRecord(a.governance_evidence)
    || hasEvidenceRecord(a.regression_evidence)
  )) || (attempts.length > 0 ? attempts[attempts.length - 1] : null);

  const gates = deriveGates({ task, testRuns, reviews, regressionRuns, greenAttempt });

  return {
    // Cobertura REAL por categoria de teste executada (unit/integration/e2e/unknown).
    // Fica no bundle porque `unit` e `integration` compartilham a mesma condição
    // de aprovação: o consumidor precisa poder ver o que foi executado.
    testCoverage: summarizeTestCoverage(testRuns),
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
      // ESCOPO DA IDEMPOTÊNCIA: a mesma chave só é "a mesma review" DENTRO da mesma missão. Sem
      // `mission_id` aqui, uma colisão de chave com uma review de OUTRA missão devolvia aquela
      // review (e a atual simplesmente não existia) — defeito medido em 2026-09-30.
      const existing = await Review.findOne({ where: { idempotency_key: idempotencyKey, mission_id: missionId } });
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
      idempotencyKey: idempotencyKey ? `${missionId}:${idempotencyKey}:META` : null,
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
      idempotencyKey: idempotencyKey ? `${missionId}:${idempotencyKey}:ADVERSARIAL` : null,
    });
    out.adversarial = { ...result, persistedId: row.id, persistedAt: row.created_at };
    logger.info('[missionReview] adversarial review executado', {
      missionId, status: result.status, uncovered: result.uncovered.length,
    });
  }

  // PROGRESSO SIGNIFICATIVO (§18): parecer do reviewer / adversarial review persistido é avanço
  // verificável da missão. Só é gravado quando nenhum OUTRO worker detém lease ativo da missão —
  // o dono vivo registra o próprio progresso; esta porta nunca escreve por cima dele sem fence.
  try {
    const { resolveLeaseState } = require('../../../engine/engineeringMission/leasePolicy');
    const lease = await missionStore.getMissionLease(missionId);
    const ownedByOther = lease && lease.token && resolveLeaseState(lease, Date.now()) === 'ACTIVE';
    if (!ownedByOther) {
      if (out.meta) await missionStore.recordMissionProgress(missionId, { signal: 'reviewer_result', detail: `meta review: ${out.meta.status || 'done'}` });
      if (out.adversarial) await missionStore.recordMissionProgress(missionId, { signal: 'reviewer_result', detail: `adversarial review: ${out.adversarial.status || 'done'}` });
    }
  } catch (error) {
    logger.warn('[missionReview] progresso do review não registrado', { missionId, message: error.message });
  }

  // Enforcement de GREEN em AMBOS os sentidos. O orquestrador recusa GREEN quando a revisão da
  // versão corrente bloqueia — mas ele só é consultado quando o estado é RECALCULADO. Uma revisão
  // rodada DEPOIS de a missão já estar GREEN (ou seja: execução primeiro, revisão depois) deixava
  // a missão GREEN com um parecer bloqueante persistido — bypass do §23. Recalcular aqui fecha
  // esse vetor, independentemente de quem chamou a revisão (rota, resume ou teste).
  // Require preguiçoso: o orquestrador já depende deste serviço (§ ciclo de módulos).
  const anyBlocking = Boolean(out.meta?.blocksGreen || out.adversarial?.blocksGreen);
  // Um parecer bloqueante é TRABALHO: entrega o item ao ciclo de bug (MESMO modelo de finding) antes
  // de reavaliar o estado. Idempotente por fingerprint+missão: rodar a revisão duas vezes agrega
  // ocorrência ao finding canônico, nunca cria um segundo.
  if (anyBlocking) {
    try {
      const blockingNow = await getBlockingReview(missionId, mission.current_version);
      out.bugFindings = await intakeBlockingFindings(missionId, blockingNow, { actor });
    } catch (error) {
      out.bugFindingError = { code: error.code || null, message: error.message };
      logger.error('[missionReview] falha ao entregar blocker de revisão ao ciclo de bug', { missionId, message: error.message });
      throw error;
    }
  }
  const missionNow = await missionStore.getMission(missionId);
  if (anyBlocking || missionNow?.status === 'GREEN') {
    const orchestrator = require('./missionOrchestratorService');
    await orchestrator.refreshMissionState(missionId, { tenantId: mission.tenant_id || PLATFORM_TENANT_ID });
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
    .map((f) => ({ id: f.id, checkId: f.checkId, severity: f.severity, title: f.title, detail: f.detail || null }))
    .filter((f) => f.id);
  // A review ADVERSARIAL registra `uncovered` (ataques sem teste) em vez de `findings`.
  const uncovered = plain.kind === 'ADVERSARIAL'
    ? (Array.isArray(plain.findings) ? plain.findings.filter((c) => c && c.status === 'UNCOVERED') : [])
      .map((c) => ({ id: c.id, checkId: 'ADVERSARIAL_CASE_UNCOVERED', severity: c.severity, title: c.attack, detail: c.attack, permanentTest: c.permanentTest || null }))
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

/**
 * META_REVIEW_TO_BUG_LOOP / ADVERSARIAL_TO_BUG_LOOP.
 *
 * Um parecer BLOQUEANTE não pode ficar só no relatório: se a revisão reprova a missão, o resultado é
 * um DEFEITO que o ciclo de bug precisa corrigir — no MESMO modelo de finding, com a MESMA triagem,
 * correção, regressão e governança. Sem esta porta, o gate recusava o GREEN e ninguém era acionado
 * (a reprovação existia e não produzia trabalho).
 *
 * O caso ADVERSARIAL traz o TESTE PERMANENTE que deveria cobrir o ataque: quando existe caminho
 * declarado, a reprodução é derivada dele (rodar o teste e ver falhar) — nada é inventado. Um caso
 * sem teste permanente entra como lacuna declarada, sem comando fabricado.
 */
async function intakeBlockingFindings(missionId, blocking, { actor = null } = {}) {
  if (!blocking || !Array.isArray(blocking.blockingFindings) || blocking.blockingFindings.length === 0) return [];
  // Require preguiçoso: o serviço de findings e este compartilham o orquestrador (§ ciclo).
  const bugFindingService = require('./bugFindingService');
  const engine = require('../../../engine/engineeringMission/bugFinding');
  const mission = await missionStore.getMission(missionId);
  const registered = [];

  for (const item of blocking.blockingFindings) {
    const isAdversarial = blocking.kind === 'ADVERSARIAL';
    const permanentTest = isAdversarial && item.permanentTest ? item.permanentTest : null;
    const reproduction = permanentTest && permanentTest.path
      ? {
        command: `npx jest ${permanentTest.path}${permanentTest.namePattern ? ` -t "${permanentTest.namePattern}"` : ''}`,
        expect: 'FAIL',
        strategy: 'DECLARED_TEST_COMMAND',
        source: 'ADVERSARIAL_CASE',
      }
      : {};

    // O título carrega o ID DO CASO (ADV-01, MR-03...) além do checkId: é o identificador que o
    // catálogo e o relatório usam, e sem ele a fila de bugs não permitiria rastrear o item de volta.
    const caseId = item.id || item.checkId;
    const title = `[${blocking.kind}] ${caseId}${item.checkId && item.checkId !== caseId ? ` (${item.checkId})` : ''}: ${item.title || caseId}`;
    const { finding, deduplicated } = await bugFindingService.registerFinding({
      missionId,
      missionVersion: mission?.current_version ?? null,
      missionSpecHash: mission?.current_spec_hash ?? null,
      source: isAdversarial ? 'ADVERSARIAL_REVIEW' : 'META_REVIEW',
      origin: isAdversarial ? 'ADVERSARIAL_REVIEW' : 'META_REVIEW',
      fingerprint: engine.computeFingerprint({
        source: isAdversarial ? 'ADVERSARIAL_REVIEW' : 'META_REVIEW',
        // A IDENTIDADE inclui o ID DO CASO: dois blockers diferentes do mesmo tipo (ex.: 20 ataques
        // não cobertos) têm que gerar 20 findings — usar só o checkId os colapsaria em um único
        // registro e 19 defeitos desapareceriam da fila.
        invariant: `${blocking.kind}:${item.checkId}:${item.id}`,
        title,
      }),
      title,
      description: `Parecer ${blocking.kind} (review ${blocking.id}) reprovou a missão neste item; o bloqueio de GREEN é tratado como defeito do sistema, não como observação.`,
      expectedBehavior: 'nenhum item bloqueante em aberto na revisão de referência da missão',
      observedBehavior: item.detail || item.title || item.id,
      affectedFiles: permanentTest && permanentTest.path ? [permanentTest.path] : [],
      // SEVERIDADE OBJETIVA do parecer: o motor aceita impacto objetivo declarado e nunca o deixa
      // abaixo disso. Um BLOCKER de revisão que entrasse como MEDIUM subestimaria o risco do próprio
      // bloqueio — e `severityHint`/sinais textuais não seriam autoridade para isso.
      objectiveSeverity: item.severity === 'BLOCKER' ? 'CRITICAL' : 'HIGH',
      reproduction,
      evidenceRefs: [
        messengerEvidence(blocking, item),
      ],
      provenance: 'WORK',
    }, { actor: actor || `REVIEW:${blocking.kind}` });

    registered.push({ findingId: finding.id, checkId: item.checkId, created: deduplicated !== true, kind: blocking.kind });
    logger.info('[missionReview] blocker de revisão entregue ao ciclo de bug', {
      missionId, reviewId: blocking.id, kind: blocking.kind, checkId: item.checkId, findingId: finding.id, created: deduplicated !== true,
    });
  }
  return registered;
}

/** Evidência de review no formato do modelo de finding (a review é a prova da observação). */
function messengerEvidence(blocking, item) {
  return {
    type: 'REVIEW_VERDICT',
    ref: `review:${blocking.id}:${item.checkId}`,
    detail: `${blocking.kind} ${blocking.status} · ${item.severity || 'n/d'} · ${item.title || item.id}`,
    source: 'missionReviewService',
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
  intakeBlockingFindings,
  getLatestReview,
  listReviews,
  getBlockingReview,
};
