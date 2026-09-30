'use strict';

/**
 * Enforcement do Meta Reviewer e autoavaliação (§23, §24, §45).
 *
 * O ponto central provado aqui: uma missão NÃO pode ser declarada GREEN enquanto a revisão da
 * versão corrente tiver finding BLOQUEANTE — e o finding é produzido pelo motor real, a partir de
 * artefatos persistidos reais (patch com segredo, execução de teste, review do Router), não por um
 * registro fabricado à mão.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const reviewService = require('../../api/services/engineeringMission/missionReviewService');
const selfAssessment = require('../../api/services/engineeringMission/missionSelfAssessmentService');

const RAW_MISSION = 'Corrija o defeito de soma em mathUtils.';

const SECRET_PATCH = [
  'diff --git a/api/services/qualquer.js b/api/services/qualquer.js',
  '--- a/api/services/qualquer.js',
  '+++ b/api/services/qualquer.js',
  '@@ -1,0 +1,2 @@',
  '+const apiKey = "sk-abcdefghijklmnopqrstuvwx";',
  '+function f() { return 1; }',
].join('\n');

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-review-enforcement', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

function models() {
  const index = require('../../api/db/models');
  return {
    Mission: index.EngineeringMission(),
    Version: index.EngineeringMissionVersion(),
    Approval: index.EngineeringMissionApproval(),
    Review: index.EngineeringMissionReview(),
    Task: index.EngineeringTask(),
    Attempt: index.EngineeringAttempt(),
    TestRun: index.EngineeringTestRun(),
    ReviewRow: index.EngineeringReview(),
    BugFinding: index.EngineeringBugFinding(),
    BugFindingEvent: index.EngineeringBugFindingEvent(),
  };
}

/** Fabrica os artefatos persistidos que o Router teria deixado (attempt + test run + review). */
async function fabricateExecutedTaskArtifacts(taskId, { patchDiff, acceptanceCriteria }) {
  const m = models();
  await m.Task.update(
    { status: 'GREEN', acceptance_criteria: acceptanceCriteria },
    { where: { id: taskId } },
  );
  const attempt = await m.Attempt.create({
    task_id: taskId,
    attempt_number: 1,
    status: 'DONE',
    coder_provider: 'anthropic',
    coder_model: 'claude-sonnet-5',
    patch_diff: patchDiff,
    routing_reason_codes: ['CAPABILITY_MATCH'],
  });
  await m.TestRun.create({
    attempt_id: attempt.id,
    command: 'npx jest DR-ENGINEERING_MEMORY_REUSE --no-coverage',
    status: 'PASS',
    exit_code: 0,
    stdout_excerpt: 'DR-ENGINEERING_MEMORY_REUSE ok',
  });
  await m.ReviewRow.create({
    attempt_id: attempt.id,
    reviewer_provider: 'mistral',
    reviewer_model: 'mistral-large-latest',
    decision: 'APPROVE',
    findings: [],
    independent_of_coder: true,
  });
  return attempt;
}

async function buildMission() {
  const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-review' });
  createdMissionIds.push(mission.id);
  await approvalService.approve(mission.id, { actor: 'jest-review' });
  const started = await orchestrator.startExecution(mission.id, { actor: 'jest-review', tenantId: 'system' });
  return { missionId: mission.id, taskId: started.task.id, spec: started.mission.currentSpec };
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
    // Resíduo de execução interrompida: findings de teste abertos entrariam na varredura GLOBAL do
    // laço de bugs (que existe para achar todo bug pendente) e degradariam esta suíte.
    const { purgeTestFindings } = require('../helpers/purgeTestFindings');
    await purgeTestFindings();
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (!dbAvailable) return;
  const m = models();
  try {
    for (const missionId of createdMissionIds) {
      const mission = await missionStore.getMission(missionId);
      if (mission?.linked_task_id) {
        const attempts = await m.Attempt.findAll({ where: { task_id: mission.linked_task_id } });
        for (const a of attempts) {
          await m.TestRun.destroy({ where: { attempt_id: a.id } });
          await m.ReviewRow.destroy({ where: { attempt_id: a.id } });
        }
        await m.Attempt.destroy({ where: { task_id: mission.linked_task_id } });
        await m.Task.destroy({ where: { id: mission.linked_task_id } });
      }
      await m.Review.destroy({ where: { mission_id: missionId } });
      await m.Approval.destroy({ where: { mission_id: missionId } });
      await m.Version.destroy({ where: { mission_id: missionId } });
      await m.Mission.destroy({ where: { id: missionId } });
      // Findings do ciclo de bug criados pela porta review→bug (META_REVIEW_TO_BUG_LOOP /
      // ADVERSARIAL_TO_BUG_LOOP): apagados junto da missão para não contaminar a varredura do laço.
      const findings = await m.BugFinding.findAll({ where: { mission_id: missionId } });
      if (findings.length > 0) {
        const ids = findings.map((f) => f.id);
        await m.BugFindingEvent.destroy({ where: { finding_id: ids } });
        await m.BugFinding.destroy({ where: { id: ids } });
      }
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Mission — Meta/Adversarial review e enforcement de GREEN', () => {
  jest.setTimeout(90000);

  test('missão limpa: revisão roda, é persistida e NÃO bloqueia GREEN', async () => {
    if (skipIfNoDatabase()) return;
    const { missionId, taskId, spec } = await buildMission();
    await fabricateExecutedTaskArtifacts(taskId, {
      patchDiff: [
        'diff --git a/api/services/qualquer.js b/api/services/qualquer.js',
        '--- a/api/services/qualquer.js',
        '+++ b/api/services/qualquer.js',
        '@@ -1,0 +1,1 @@',
        '+function soma(a, b) { return a + b; }',
      ].join('\n'),
      acceptanceCriteria: spec.acceptanceCriteria,
    });

    const reviews = await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META', 'ADVERSARIAL'] });
    expect(reviews.meta.status).toBe('INCOMPLETE'); // NOT_VERIFIABLE explícitos, nunca PASS cego
    expect(reviews.meta.blocksGreen).toBe(false);
    expect(reviews.adversarial.status).toBe('PASS'); // todos os ataques do catálogo têm teste permanente
    expect(reviews.adversarial.uncovered).toHaveLength(0);

    // Sem review bloqueante, a missão GREEN permanece GREEN.
    const detail = await orchestrator.refreshMissionState(missionId, { tenantId: 'system' });
    expect(detail.status).toBe('GREEN');

    // Persistência real dos findings.
    const persisted = await reviewService.listReviews(missionId);
    expect(persisted.map((r) => r.kind).sort()).toEqual(['ADVERSARIAL', 'META']);
    expect(persisted.find((r) => r.kind === 'META').findings.length).toBeGreaterThan(0);
  }, 90000);

  test('patch com segredo: revisão bloqueia e missão NUNCA fica GREEN', async () => {
    if (skipIfNoDatabase()) return;
    const { missionId, taskId, spec } = await buildMission();
    await fabricateExecutedTaskArtifacts(taskId, { patchDiff: SECRET_PATCH, acceptanceCriteria: spec.acceptanceCriteria });

    const reviews = await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'] });
    expect(reviews.meta.blocksGreen).toBe(true);
    expect(reviews.meta.counts.blockers).toBeGreaterThan(0);

    const secret = reviews.meta.findings.find((f) => f.checkId === 'NO_SECRETS_IN_PATCH');
    expect(secret.status).toBe('FAIL');
    expect(secret.evidence.length).toBeGreaterThan(0);

    const blocking = await reviewService.getBlockingReview(missionId, 1);
    expect(blocking.kind).toBe('META');
    expect(blocking.blockingFindings.map((f) => f.checkId)).toContain('NO_SECRETS_IN_PATCH');

    // META_REVIEW_TO_BUG_LOOP: o blocker não fica só no relatório — ele entra no MESMO modelo de
    // finding que o ciclo de bug corrige, com a missão de origem e o item exato que reprovou.
    const m = models();
    const bugFindings = await m.BugFinding.findAll({ where: { mission_id: missionId } });
    const secretFinding = bugFindings.find((f) => String(f.title).includes('NO_SECRETS_IN_PATCH'));
    expect(secretFinding).toBeTruthy();
    expect(secretFinding.source).toBe('META_REVIEW');
    expect(secretFinding.origin).toBe('META_REVIEW');
    expect(['CRITICAL', 'HIGH']).toContain(secretFinding.severity);
    expect(String(secretFinding.description)).toContain('bloqueio de GREEN');
    const events = await m.BugFindingEvent.findAll({ where: { finding_id: secretFinding.id } });
    expect(events.length).toBeGreaterThan(0);

    // IDEMPOTENTE: rodar a revisão outra vez agrega ocorrência ao finding canônico — nunca cria um
    // segundo registro para o mesmo blocker (inclusive por chave de idempotência da review).
    await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'], idempotencyKey: 'rev-secret-1' });
    await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'], idempotencyKey: 'rev-secret-1' });
    const again = await m.BugFinding.findAll({ where: { mission_id: missionId, source: 'META_REVIEW' } });
    const secretAgain = again.filter((f) => String(f.title).includes('NO_SECRETS_IN_PATCH'));
    expect(secretAgain).toHaveLength(1);
    expect(secretAgain[0].occurrences).toBeGreaterThan(1);

    // O ENFORCEMENT: a task está GREEN (o Router atestou), mas a missão NÃO pode ser GREEN.
    const detail = await orchestrator.refreshMissionState(missionId, { tenantId: 'system' });
    expect(detail.status).toBe('BLOCKED');
    expect(detail.displayStatus).toBe('BLOCKED');
    expect(detail.failure.code).toBe('META_REVIEW_BLOCKED');
    expect(detail.failure.findings.map((f) => f.checkId)).toContain('NO_SECRETS_IN_PATCH');
  }, 90000);

  test('revisão rodada DEPOIS de um GREEN já concedido derruba a missão (bypass fechado)', async () => {
    if (skipIfNoDatabase()) return;
    const { missionId, taskId, spec } = await buildMission();
    await fabricateExecutedTaskArtifacts(taskId, { patchDiff: SECRET_PATCH, acceptanceCriteria: spec.acceptanceCriteria });

    // Ordem 1: executa primeiro. Sem NENHUMA revisão persistida ainda, nada bloqueia — o estado
    // recalculado é GREEN. Este é exatamente o estado que o bypass explorava.
    const before = await orchestrator.refreshMissionState(missionId, { tenantId: 'system' });
    expect(before.status).toBe('GREEN');

    // Ordem 2: a revisão roda DEPOIS (fluxo real do usuário: executar → revisar). Com o veto do
    // §23, rodar a revisão depois de conceder GREEN não pode deixar a missão verde.
    const reviews = await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'] });
    expect(reviews.meta.blocksGreen).toBe(true);
    expect(reviews.missionStateReevaluated).toBe(true);

    const after = await missionStore.getMission(missionId);
    expect(after.status).toBe('BLOCKED');
    expect(after.failure.code).toBe('META_REVIEW_BLOCKED');
    expect(after.failure.reviewKind).toBe('META');

    // E o estado não volta sozinho para GREEN enquanto o parecer bloqueante estiver vigente.
    const reconciled = await orchestrator.refreshMissionState(missionId, { tenantId: 'system' });
    expect(reconciled.status).toBe('BLOCKED');
  }, 90000);

  test('revisão é idempotente por chave e o histórico é preservado', async () => {
    if (skipIfNoDatabase()) return;
    const { missionId, taskId, spec } = await buildMission();
    await fabricateExecutedTaskArtifacts(taskId, { patchDiff: SECRET_PATCH, acceptanceCriteria: spec.acceptanceCriteria });

    await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'], idempotencyKey: 'rev-1' });
    await reviewService.runReviews(missionId, { actor: 'jest-review', kinds: ['META'], idempotencyKey: 'rev-1' });
    const all = await reviewService.listReviews(missionId);
    expect(all.filter((r) => r.kind === 'META')).toHaveLength(1);
  }, 90000);

  test('ADVERSARIAL_TO_BUG_LOOP: caso descoberto vira finding com reprodução derivada do teste permanente', async () => {
    if (skipIfNoDatabase()) return;
    const { missionId } = await buildMission();
    const m = models();

    // O motor ADVERSARIAL REAL avalia o catálogo contra um mundo onde nenhum teste permanente
    // existe: todos os 20 ataques ficam UNCOVERED. Nada é fabricado — o resultado é do motor que
    // roda em produção, só a existência dos arquivos é parametrizada.
    const { evaluateAdversarialCoverage } = require('../../engine/engineeringMission/adversarialReview');
    const result = evaluateAdversarialCoverage(() => false, () => '');
    expect(result.uncovered.length).toBeGreaterThan(0);

    const mission = await missionStore.getMission(missionId);
    await m.Review.create({
      mission_id: missionId,
      mission_version: mission.current_version,
      spec_hash: mission.current_spec_hash,
      kind: result.kind,
      status: result.status,
      blocks_green: true,
      counts: { total: result.total, covered: result.covered, uncovered: result.uncovered.length },
      findings: result.cases,
      summary: { notAutomatable: 0 },
      engine_version: result.engineVersion,
      actor: 'jest-review',
    });

    const blocking = await reviewService.getBlockingReview(missionId, mission.current_version);
    expect(blocking.kind).toBe('ADVERSARIAL');
    expect(blocking.blockingFindings.length).toBe(result.uncovered.length);
    expect(blocking.blockingFindings[0].permanentTest).toBeTruthy();

    const registered = await reviewService.intakeBlockingFindings(missionId, blocking, { actor: 'jest-review' });
    expect(registered).toHaveLength(result.uncovered.length);
    expect(registered.every((r) => r.created)).toBe(true);

    const stored = await m.BugFinding.findAll({ where: { mission_id: missionId, source: 'ADVERSARIAL_REVIEW' } });
    expect(stored).toHaveLength(result.uncovered.length);
    const first = stored.find((f) => String(f.title).includes(result.uncovered[0].id));
    expect(first).toBeTruthy();
    expect(first.origin).toBe('ADVERSARIAL_REVIEW');
    // A reprodução NÃO foi inventada: é o teste permanente declarado pelo próprio catálogo.
    expect(first.reproduction.command).toContain(result.uncovered[0].permanentTest.path);
    expect(first.reproduction.command).toContain(result.uncovered[0].permanentTest.namePattern);
    expect(first.reproduction.expect).toBe('FAIL');
    expect(first.reproduction.strategy).toBe('DECLARED_TEST_COMMAND');

    // Reentrega do MESMO parecer: agrega ocorrência, não duplica (dedup por fingerprint+missão).
    const second = await reviewService.intakeBlockingFindings(missionId, blocking, { actor: 'jest-review' });
    expect(second.every((r) => r.created === false)).toBe(true);
    expect(second.map((r) => r.findingId).sort()).toEqual(registered.map((r) => r.findingId).sort());
    const after = await m.BugFinding.findAll({ where: { mission_id: missionId, source: 'ADVERSARIAL_REVIEW' } });
    expect(after).toHaveLength(result.uncovered.length);
  }, 90000);

  test('§45 autoavaliação: taxas calculadas de dados reais e null quando não há medição', async () => {
    if (skipIfNoDatabase()) return;
    const assessment = await selfAssessment.computeSelfAssessment({ limit: 200 });

    expect(assessment.artifactType).toBe('engineering-mission-self-assessment');
    expect(assessment.window.missionsAnalyzed).toBeGreaterThan(0);
    expect(assessment.enrichment.missionsEnriched).toBeGreaterThan(0);
    expect(assessment.enrichment.avgDerivedRequirements).toBeGreaterThan(0);
    expect(assessment.approval.decisions).toBeGreaterThan(0);
    // As três taxas de decisão fecham em 1 quando existe decisão.
    const sum = assessment.approval.humanApprovalRate + assessment.approval.autoApprovalRate + assessment.approval.rejectionRate;
    expect(Number(sum.toFixed(3))).toBe(1);
    expect(assessment.execution.executed).toBeGreaterThan(0);
    expect(assessment.reviews.metaRuns).toBeGreaterThan(0);
    // Sem provider real devolvendo usage, o custo é null — nunca 0 fingindo medição.
    expect(assessment.cost.totalTokens === null || typeof assessment.cost.totalTokens === 'number').toBe(true);
    expect(Array.isArray(assessment.models.byProviderModel)).toBe(true);
    expect(assessment.notes.join(' ')).toMatch(/políticas determinísticas/);
  }, 60000);

  test('§45 taxa sem denominador é null (não zero enganoso)', async () => {
    if (skipIfNoDatabase()) return;
    const rate = selfAssessment.rate(0, 0);
    expect(rate).toBeNull();
    expect(selfAssessment.rate(1, 4)).toBe(0.25);
  });
});
