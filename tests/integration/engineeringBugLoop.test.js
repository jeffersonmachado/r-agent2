'use strict';

/**
 * CICLO DE BUG end-to-end no nível de SERVIÇO (BUG-01, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07,
 * BUG-09, BUG-10, BUG-11, BUG-13, BUG-14, BUG-15, BUG-16, BUG-17, BUG-18, BUG-19, BUG-20).
 *
 * Banco REAL (nada de mock de persistência). O ÚNICO dublê é o Router (`runTask`): a execução do
 * loop durável — lease, sandbox, patch, testes, promoção — é provada no E2E
 * `engineeringBugAutonomousLoopE2E.test.js`, com o Router REAL e providers roteados de verdade.
 * Aqui prova-se que o ciclo de bug CONSOME o resultado real do Router corretamente (evidências,
 * pareceres, regressões) — inclusive que um patch sem as três provas NÃO vira FIXED.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (nunca verde silencioso).
 */

jest.mock('../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(),
}));

const sequelizeModule = require('../../api/db/sequelize');
const models = require('../../api/db/models');
const { skipOrFail } = require('../helpers/infraGate');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const bugReproductionService = require('../../api/services/engineeringMission/bugReproductionService');
const bugTriageService = require('../../api/services/engineeringMission/bugTriageService');
const bugLoop = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');

let dbAvailable = false;
let dbReason = null;

// Timeout da suíte: o global é 10s (jest.config.cjs) e é insuficiente aqui. Defeito MEDIDO no selo
// autoritativo (2026-09-29): rodando em lote com o E2E do Router REAL
// (`engineeringBugAutonomousLoopE2E.test.js`, que sobe sandbox Docker no MESMO processo Jest), a
// criação de finding/DB estourou 10s e o `bail: 1` abortou o lote inteiro sem sequer produzir o
// relatório do Jest — o selo saiu NO_GO em SUITE_EXECUTION. Mesma convenção das suítes vizinhas
// (DurableResume, DistributedLease, BootRecovery: 30-60s), que já declaram o próprio timeout por
// causa da contenção de recursos na execução agregada.
//
// Colocado no ESCOPO DO MÓDULO de propósito: dentro de `beforeAll` o valor NÃO é aplicado
// (medido — a falha continuou marcando 10000 ms); no topo do arquivo vale para todas as suítes.
jest.setTimeout(60000);

const created = { findings: [], tasks: [], missions: [], testRuns: [], reviews: [], regressionRuns: [] };

const SUITE_NAME = 'engineering-bug-loop';

/**
 * PULO REGISTRADO, nunca silencioso: a porta única `tests/helpers/infraGate.js` registra
 * `NOT_EXECUTED` em modo dev e lança `INFRA_ERROR` em `RELEASE_AUTHORITATIVE=1` — banco fora do ar
 * nunca pode virar PASS agregado.
 */
function skipIfNoDatabase() {
  if (dbAvailable) return false;
  return skipOrFail({ suite: SUITE_NAME, available: false, reason: `postgres_unreachable (${dbReason})`, requirement: 'postgres' });
}

const REPRODUCTION_COMMAND = 'npx jest tests/unit/engineeringBugFindingEngine.test.js --bail=0';
const FIX_COMMAND = 'npx jest tests/unit/engineeringBugFindingEngine.test.js';

/** Runner determinístico: a falha de reprodução é o BUG; o fix a torna verde. */
function runnerReturning(outcome) {
  return {
    createWorkspace: jest.fn(async () => '/tmp/fake-workspace'),
    destroyWorkspace: jest.fn(async () => {}),
    runCommands: jest.fn(async ({ commands }) => ({
      allPass: outcome === 'PASS',
      outcome,
      results: commands.map((command) => ({
        command,
        status: outcome,
        outcome,
        exitCode: outcome === 'PASS' ? 0 : 1,
        durationMs: 12,
        stdoutRef: 'reports/fake.stdout.log',
        stderrRef: 'reports/fake.stderr.log',
      })),
    })),
  };
}

async function registerConfirmed({ title, source = 'UNIT_TEST', severitySignals = [], category = null, affectedFiles = ['api/services/demo.js'], reproduction = { command: REPRODUCTION_COMMAND, expect: 'FAIL' } } = {}) {  const { finding } = await bugFindingService.registerFinding({
    source,
    title,
    description: 'falha detectada no ciclo',
    category: category || undefined,
    subsystem: 'ENGINEERING_MISSION',
    symbol: title,
    affectedFiles,
    affectedSubsystems: ['ENGINEERING_MISSION'],
    signals: severitySignals,
    reproduction,
    evidenceRefs: [{ type: 'TEST_REPORT', ref: `jest:${title}`, detail: 'suite reprovada' }],
  }, { actor: 'TEST' });
  created.findings.push(finding.id);
  return finding;
}

/**
 * O dublê substitui a EXECUÇÃO do Router, não o seu efeito: o status terminal real precisa existir
 * no banco, senão o ciclo de bug estaria lendo um estado que o Router nunca teria deixado.
 */
async function simulateTaskStatus(taskId, status) {
  await models.getEngineeringTask().update({ status }, { where: { id: taskId } });
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    const { EngineeringBugFindingEvent, EngineeringBugFinding, EngineeringRegressionRun, EngineeringReview, EngineeringTestRun, EngineeringTask, EngineeringMission } = {
      EngineeringBugFindingEvent: models.getEngineeringBugFindingEvent(),
      EngineeringBugFinding: models.getEngineeringBugFinding(),
      EngineeringRegressionRun: models.getEngineeringRegressionRun(),
      EngineeringReview: models.getEngineeringReview(),
      EngineeringTestRun: models.getEngineeringTestRun(),
      EngineeringTask: models.getEngineeringTask(),
      EngineeringMission: models.getEngineeringMission(),
    };
    if (created.reviews.length) await EngineeringReview.destroy({ where: { id: created.reviews } });
    if (created.testRuns.length) await EngineeringTestRun.destroy({ where: { id: created.testRuns } });
    if (created.regressionRuns.length) await EngineeringRegressionRun.destroy({ where: { id: created.regressionRuns } });
    if (created.findings.length) {
      await EngineeringBugFindingEvent.destroy({ where: { finding_id: created.findings } });
      await EngineeringBugFinding.destroy({ where: { id: created.findings } });
    }
    for (const taskId of created.tasks) {
      const task = await EngineeringTask.findByPk(taskId).catch(() => null);
      if (task) {
        await EngineeringTestRun.destroy({ where: { attempt_id: (await engineeringTaskService.listAttempts(taskId).catch(() => [])).map((a) => a.id) } }).catch(() => {});
        await models.getEngineeringAttempt().destroy({ where: { task_id: taskId } }).catch(() => {});
        await EngineeringTask.destroy({ where: { id: taskId } });
      }
    }
    if (created.missions.length) await EngineeringMission.destroy({ where: { id: created.missions } });
  } catch (_) { /* best-effort */ }
});

beforeEach(() => {
  runTask.mockReset();
});

describe('ciclo de bug — detecção, reprodução e deduplicação', () => {
  test('BUG-01: falha de teste unitário gera finding SUSPECTED persistido com a fonte correta', async () => {
    if (skipIfNoDatabase()) return;
    const { finding, deduplicated } = await bugFindingService.registerFinding({
      source: 'UNIT_TEST',
      title: 'BUG-01 unit failure',
      description: 'suite tests/unit/x.test.js reprovou',
      subsystem: 'ENGINEERING_MISSION',
      symbol: 'BUG-01',
      test: 'tests/unit/x.test.js',
      evidenceRefs: [{ type: 'TEST_REPORT', ref: 'jest:bug-01', detail: 'expected 1 received 2' }],
    }, { actor: 'TEST' });
    created.findings.push(finding.id);

    expect(deduplicated).toBe(false);
    expect(finding.status).toBe('SUSPECTED');
    expect(finding.source).toBe('UNIT_TEST');
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.id).toBe(finding.id);
    expect(persisted.evidence_refs).toHaveLength(1);
    const history = await bugFindingService.getFindingHistory(finding.id);
    expect(history.map((e) => e.type)).toContain('REGISTERED');
  });

  test('BUG-03: reprodução que falha CONFIRMA o bug com base objetiva e evidência', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-03 reprodutível' });
    const result = await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    expect(result.outcome).toBe('REPRODUCED');
    expect(result.finding.status).toBe('CONFIRMED');
    expect(result.finding.confirmation_basis).toBe('REPRODUCED_TEST_FAILURE');
    expect(result.finding.evidence_refs.length).toBeGreaterThanOrEqual(2);
  });

  test('BUG-02: missão de VERIFICAÇÃO/teste gera finding auditável, mas não vira item de correção', async () => {
    if (skipIfNoDatabase()) return;
    const { finding } = await bugFindingService.registerFinding({
      source: 'EXCEPTION',
      title: 'missão de verificação terminou em FAILED',
      description: 'task de um script de verificação terminou não-GREEN',
      subsystem: 'ENGINEERING_MISSION',
      symbol: 'verification-mission-task:FAILED',
      provenance: 'VERIFICATION',
      affectedFiles: ['api/services/demo.js'],
      reproduction: { command: REPRODUCTION_COMMAND, expect: 'FAIL' },
      evidenceRefs: [{ type: 'ARTIFACT', ref: 'verification:mission', detail: 'missão de prova' }],
    }, { actor: 'TEST' });
    created.findings.push(finding.id);
    expect(finding.triage.provenance).toBe('VERIFICATION');

    await bugFindingService.confirmFinding(finding.id, {
      basis: 'UNEQUIVOCAL_EVIDENCE',
      evidence: [{ type: 'ARTIFACT', ref: 'verification:mission' }],
      actor: 'TEST',
    });

    // A varredura do laço NÃO transforma isso em correção: o finding continua auditável, mas não
    // vira trabalho — corrigir uma missão de prova seria trabalho sobre um artefato de verificação.
    const sweep = await bugLoop.runBugLoopSweep({ limit: 50, actor: 'TEST', autoFix: false });
    const item = sweep.items.find((i) => i.findingId === finding.id);
    expect(item).toBeTruthy();
    expect(item.action).toBe('SKIPPED_VERIFICATION_PROVENANCE');
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.fix_task_id).toBeNull();
    expect(persisted.status).toBe('CONFIRMED');

    // Finding de trabalho real (WORK) continua elegível.
    const work = await registerConfirmed({ title: 'BUG-02 trabalho real elegível' });
    const workSweep = await bugLoop.runBugLoopSweep({ limit: 50, actor: 'TEST', autoFix: false });
    const workItem = workSweep.items.find((i) => i.findingId === work.id);
    expect(workItem?.action).not.toBe('SKIPPED_VERIFICATION_PROVENANCE');
  });

  test('BUG-04: reprodução que passa termina em NOT_REPRODUCED (não se confirma o que não se manifesta)', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-04 não reproduzível' });
    const result = await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('PASS'), actor: 'TEST' });
    expect(result.outcome).toBe('NOT_REPRODUCED');
    expect(result.finding.status).toBe('NOT_REPRODUCED');
  });

  test('BUG-12: reprodução com TIMEOUT fica INCONCLUSIVE e o finding volta a SUSPECTED', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-12 timeout na reprodução' });
    const result = await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('TIMEOUT'), actor: 'TEST' });
    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.finding.status).toBe('SUSPECTED');
  });

  test('BUG-05: findings equivalentes são deduplicados (uma linha, occurrences incrementado)', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-05 deduplicável' });
    const second = await bugFindingService.registerFinding({
      source: 'UNIT_TEST',
      title: 'BUG-05 deduplicável',
      subsystem: 'ENGINEERING_MISSION',
      symbol: 'BUG-05 deduplicável',
      affectedFiles: ['api/services/demo.js'],
      affectedSubsystems: ['ENGINEERING_MISSION'],
    }, { actor: 'TEST' });
    expect(second.deduplicated).toBe(true);
    expect(second.finding.id).toBe(finding.id);
    expect(second.finding.occurrences).toBe(2);
    const findings = await bugFindingService.listFindings({ fingerprint: finding.fingerprint });
    expect(findings.filter((f) => f.id === finding.id)).toHaveLength(1);
  });
});

describe('ciclo de bug — task de correção e provas do fix', () => {
  test('BUG-06 + BUG-07: bug CONFIRMED gera EngineeringTask que referencia o finding', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-06 task automática' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });

    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);

    expect(triage.fixTask).toBeTruthy();
    expect(triage.fixTask.title).toContain(finding.id);
    expect(triage.fixTask.task_type).toBe('BUG_FIX');
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.fix_task_id).toBe(triage.fixTask.id);
    expect(persisted.status).toBe('FIXING');

    // Idempotência: triar de novo NÃO cria segunda task.
    const again = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    expect(again.fixTask.id).toBe(triage.fixTask.id);
  });

  test('BUG-08: patch aplicado NÃO é fix — sem reprodução/testes/parecer o finding fica em FIXING', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-08 patch não é fix' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);

    const attempt = await engineeringTaskService.createAttempt(triage.fixTask.id, { attempt_number: 1, status: 'REVIEWED' });
    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'GREEN', attemptId: attempt.id });
    await simulateTaskStatus(triage.fixTask.id, 'GREEN');

    // GREEN do Router SEM test runs e SEM parecer: o ciclo recusa declarar FIXED.
    const result = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    expect(result.fixed).toBe(false);
    expect(result.stage).toBe('FIXED_REFUSED');
    expect(result.fixError.code).toBe('FIX_WITHOUT_REPRODUCTION');
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.status).toBe('FIXING');
  });

  test('BUG-08 + BUG-09: com reprodução verde, testes e parecer reais → FIXED e depois REGRESSION_VALIDATED', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-09 regressão após fix' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);

    const attempt = await engineeringTaskService.createAttempt(triage.fixTask.id, { attempt_number: 1, status: 'REVIEWED' });
    const testRun = await models.getEngineeringTestRun().create({
      attempt_id: attempt.id,
      command: REPRODUCTION_COMMAND,
      status: 'PASS',
      exit_code: 0,
      stdout_ref: 'reports/fake.stdout.log',
      started_at: new Date(),
      completed_at: new Date(),
    });
    const review = await models.getEngineeringReview().create({
      attempt_id: attempt.id,
      reviewer_provider: 'qdrant-fake',
      reviewer_model: 'reviewer-model',
      decision: 'APPROVE',
      findings: [],
      independent_of_coder: true,
    });
    const regression = await models.getEngineeringRegressionRun().create({
      task_id: triage.fixTask.id,
      attempt_id: attempt.id,
      plan_tier: 'MEDIUM',
      commands: [FIX_COMMAND],
      exit_codes: [0],
      source_fingerprint: 'f'.repeat(64),
      result: 'PASS',
      evidence_refs: [{ command: FIX_COMMAND, stdoutRef: 'reports/fake.stdout.log' }],
      started_at: new Date(),
      completed_at: new Date(),
    });
    created.testRuns.push(testRun.id);
    created.reviews.push(review.id);
    created.regressionRuns.push(regression.id);

    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'GREEN', attemptId: attempt.id });
    await simulateTaskStatus(triage.fixTask.id, 'GREEN');
    const result = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });

    expect(result.fixed).toBe(true);
    expect(result.regressionValidated).toBe(true);
    expect(result.closed).toBe(true);
    expect(result.evidence).toMatchObject({ reproductionPassed: true, targetedTestsPassed: true, reviewPassed: true });
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.status).toBe('CLOSED');
    const history = await bugFindingService.getFindingHistory(finding.id);
    expect(history.map((e) => e.type)).toEqual(expect.arrayContaining(['FIX_APPLIED', 'STATUS_CHANGED', 'REGRESSION_VALIDATED']));
  });

  test('BUG-08: READY_FOR_PROMOTION (patch válido, sem promoção) nunca é declarado FIXED', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-08 ready for promotion' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);
    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'READY_FOR_PROMOTION', reasonCode: 'POST_PROMOTION_SMOKE_FAILED' });
    await simulateTaskStatus(triage.fixTask.id, 'READY_FOR_PROMOTION');

    const result = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    expect(result.fixed).toBe(false);
    expect(result.taskStatus).toBe('READY_FOR_PROMOTION');
    expect((await bugFindingService.getFinding(finding.id)).status).toBe('FIXING');
  });

  test('BUG-10: bug secundário encontrado durante o fix entra no loop sem abandonar o primeiro', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-10 bug primário' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);
    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'RED', reasonCode: 'TEST_FAILED' });
    await simulateTaskStatus(triage.fixTask.id, 'RED');

    const result = await bugLoop.runFixLoop(finding.id, {
      actor: 'TEST',
      maxAttempts: 1,
      secondaryFindings: [{ source: 'REGRESSION_TEST', title: 'BUG-10 bug secundário', subsystem: 'ENGINEERING_MISSION', symbol: 'BUG-10-secondary' }],
    });
    expect(result.fixed).toBe(false);
    // Bug A continua no loop (FIXING), nunca abandonado.
    expect((await bugFindingService.getFinding(finding.id)).status).toBe('FIXING');
    // Bug B foi registrado como finding próprio.
    const findings = await bugFindingService.listFindings({ status: ['SUSPECTED'] });
    const secondary = findings.find((f) => f.title === 'BUG-10 bug secundário');
    expect(secondary).toBeTruthy();
    created.findings.push(secondary.id);
  });
});

describe('ciclo de bug — missão, telemetria e reincidência', () => {
  test('BUG-11: a missão original continua (não é reiniciada nem substituída)', async () => {
    if (skipIfNoDatabase()) return;
    const Mission = models.getEngineeringMission();
    const mission = await Mission.create({
      title: 'missão original (BUG-11)',
      original_mission: 'corrigir o módulo de demonstração',
      original_mission_hash: 'h'.repeat(64),
      mission_type: 'BUG_FIX',
      status: 'EXECUTING',
      risk: 'MEDIUM',
    });
    created.missions.push(mission.id);

    const continuation = await bugLoop.continueMission(mission.id, { actor: 'TEST', findingId: null });
    expect(continuation.resumed).toBe(true);
    expect(continuation.missionId).toBe(mission.id);
    const persisted = await Mission.findByPk(mission.id);
    expect(persisted.original_mission).toBe('corrigir o módulo de demonstração');
    expect(persisted.status).toBe('EXECUTING');
  });

  test('BUG-13: NO_PROGRESS gera diagnóstico (fase/operação) e finding SUSPECTED', async () => {
    if (skipIfNoDatabase()) return;
    const result = await bugLoop.diagnoseNoProgress({
      phase: 'REGRESSION',
      operation: 'checkRegression',
      metadata: { lastProgressSignal: 'command_completed', providerStatus: 'HEALTHY', childStatus: 'RUNNING', subsystem: 'ENGINEERING_ROUTER' },
    }, { actor: 'TEST' });
    expect(result.detections).toBe(1);
    const findingId = result.registered[0].findingId;
    created.findings.push(findingId);
    const finding = await bugFindingService.getFinding(findingId);
    expect(finding.source).toBe('NO_PROGRESS');
    expect(finding.status).toBe('SUSPECTED');
    expect(finding.category).toBe('RECOVERY');
  });

  test('BUG-14: invariante de governança violado gera finding CRÍTICO determinístico', async () => {
    if (skipIfNoDatabase()) return;
    const { finding } = await bugFindingService.registerFinding({
      source: 'GOVERNANCE_INCONSISTENCY',
      title: 'TIMEOUT_ARCHITECTURE=NO_GO com FINAL_GOVERNANCE=GO',
      description: 'invariante de governança violado',
      invariant: 'child-gate-direction',
      invariantOutcome: 'GO',
      childOutcome: 'NO_GO',
      subsystem: 'GOVERNANCE',
      reproduction: { invariants: [{ id: 'child-gate-direction', expression: 'child NO_GO implica parent NO_GO' }] },
      evidenceRefs: [{ type: 'INVARIANT_EVALUATION', ref: 'governance:child-gate-direction', detail: 'parent GO, child NO_GO' }],
    }, { actor: 'TEST' });
    created.findings.push(finding.id);
    expect(finding.category).toBe('GOVERNANCE');
    expect(finding.severity).toBe('CRITICAL');

    const confirmed = await bugReproductionService.reproduce(finding.id, {
      actor: 'TEST',
      invariantResults: [{ id: 'child-gate-direction', violated: true, detail: 'GO com filho NO_GO' }],
    });
    expect(confirmed.outcome).toBe('REPRODUCED');
    expect(confirmed.finding.status).toBe('CONFIRMED');
    expect(confirmed.finding.confirmation_basis).toBe('DETERMINISTIC_INVARIANT_VIOLATION');
  });

  test('BUG-15: stale writer gera finding de CONCURRENCY CRÍTICO', async () => {
    if (skipIfNoDatabase()) return;
    const result = await bugLoop.ingestTelemetry({
      metrics: { staleWrites: 1, entity: 'engineering_tasks' },
      context: { subsystem: 'LEASE_FENCING' },
    }, { actor: 'TEST' });
    const findingId = result.registered[0].findingId;
    created.findings.push(findingId);
    const finding = await bugFindingService.getFinding(findingId);
    expect(finding.category).toBe('CONCURRENCY');
    expect(finding.severity).toBe('CRITICAL');
    expect(finding.severity_signals).toContain('STALE_WRITER_OVERWRITE');
    expect(finding.status).toBe('SUSPECTED');
  });

  test('BUG-17 + BUG-18: reincidência de bug corrigido é reconhecida, escala severidade e mantém a identidade', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({ title: 'BUG-17 recorrente' });
    await bugReproductionService.reproduce(finding.id, { runner: runnerReturning('FAIL'), actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);
    const attempt = await engineeringTaskService.createAttempt(triage.fixTask.id, { attempt_number: 1, status: 'REVIEWED' });
    created.testRuns.push((await models.getEngineeringTestRun().create({
      attempt_id: attempt.id, command: REPRODUCTION_COMMAND, status: 'PASS', exit_code: 0, started_at: new Date(), completed_at: new Date(),
    })).id);
    created.reviews.push((await models.getEngineeringReview().create({
      attempt_id: attempt.id, decision: 'APPROVE', findings: [], independent_of_coder: true,
    })).id);
    created.regressionRuns.push((await models.getEngineeringRegressionRun().create({
      task_id: triage.fixTask.id, attempt_id: attempt.id, plan_tier: 'MEDIUM', commands: [FIX_COMMAND], exit_codes: [0], result: 'PASS', evidence_refs: [],
    })).id);
    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'GREEN', attemptId: attempt.id });
    await simulateTaskStatus(triage.fixTask.id, 'GREEN');
    const fix = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    expect(fix.closed).toBe(true);
    const beforeSeverity = fix.finding.severity;

    const recurrence = await bugFindingService.registerFinding({
      source: 'UNIT_TEST',
      title: 'BUG-17 recorrente',
      subsystem: 'ENGINEERING_MISSION',
      symbol: 'BUG-17 recorrente',
      affectedFiles: ['api/services/demo.js'],
      affectedSubsystems: ['ENGINEERING_MISSION'],
      evidenceRefs: [{ type: 'TEST_REPORT', ref: 'jest:recurrence', detail: 'falhou de novo' }],
    }, { actor: 'TEST' });

    expect(recurrence.recurrence).toBe(true);
    expect(recurrence.finding.id).toBe(finding.id);
    expect(recurrence.finding.status).toBe('CONFIRMED');
    expect(recurrence.finding.recurrence_count).toBe(1);
    expect(recurrence.finding.severity).not.toBe(beforeSeverity);
    const history = await bugFindingService.getFindingHistory(finding.id);
    expect(history.some((e) => e.type === 'RECURRENCE')).toBe(true);

    // BUG-18: a ENGINEERING MEMORY recupera a ocorrência anterior pela MESMA identidade —
    // task de correção anterior e regressões que já cobriram esta falha — para não resolver do zero.
    const memory = await bugFindingService.getFindingMemory(finding.fingerprint, { excludeId: 'outro-finding' });
    expect(memory.known).toBe(true);
    expect(memory.lastFixTaskId).toBe(triage.fixTask.id);
    expect(memory.priorRegressionCommands.length).toBeGreaterThan(0);
    expect(memory.priorFindings[0].id).toBe(finding.id);
  });
});

describe('ciclo de bug — self-modification (BUG-16, BUG-19, BUG-20)', () => {
  test('BUG-16: finding de segurança exige revisor de segurança e independente', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({
      title: 'BUG-16 segredo exposto',
      source: 'SECURITY_SCAN',
      category: 'SECURITY',
      affectedFiles: ['api/modules/config/controller.js'],
    });
    await bugFindingService.addEvidence(finding.id, { type: 'LOG_CORRELATION', ref: 'scan:secret', detail: 'segredo em log' });
    await bugFindingService.confirmFinding(finding.id, { basis: 'UNEQUIVOCAL_EVIDENCE', evidence: [{ type: 'ARTIFACT', ref: 'scan:secret' }], actor: 'TEST' });
    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);
    expect(triage.assessment.capabilities.reviewer).toContain('SECURITY_REVIEW');
    expect(triage.assessment.requiresIndependentReviewer).toBe(true);

    const fix = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    // Sem execução real do Router neste teste (runTask devolve vazio): o ciclo não pode declarar
    // FIXED nem ler um status inventado.
    expect(fix.fixed).toBe(false);
    expect(fix.stage).toBe('NOT_GREEN');
  });

  test('BUG-19 + BUG-20: self-modification exige aprovação humana e não roda autonomamente', async () => {
    if (skipIfNoDatabase()) return;
    const finding = await registerConfirmed({
      title: 'BUG-19 fix no selo de governança',
      source: 'GOVERNANCE_INCONSISTENCY',
      category: 'GOVERNANCE',
      affectedFiles: ['scripts/governance/validate-bug-autonomous-loop.js'],
    });
    await bugFindingService.confirmFinding(finding.id, { basis: 'UNEQUIVOCAL_EVIDENCE', evidence: [{ type: 'ARTIFACT', ref: 'gate:bug-loop' }], actor: 'TEST' });

    const triage = await bugTriageService.triage(finding.id, { actor: 'TEST' });
    created.tasks.push(triage.fixTask.id);

    expect(triage.requiresHumanApproval).toBe(true);
    expect(triage.autoApprovalForbidden).toBe(true);
    const persisted = await bugFindingService.getFinding(finding.id);
    expect(persisted.self_modification).toBe(true);
    expect(persisted.human_approval_required).toBe(true);
    expect(persisted.auto_approval_forbidden).toBe(true);
    expect(persisted.triage.ruleBaseline).toBeTruthy();

    // Execução autônoma RECUSADA (fail-closed) — a task existe, mas não roda sozinha.
    const blocked = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    expect(blocked.executed).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.code).toBe('SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED');
    expect(runTask).not.toHaveBeenCalled();

    // Aprovação HUMANA explícita é a única coisa que destrava.
    const approval = await bugTriageService.approveSelfModification(finding.id, { actor: 'humano@results', approvalRef: 'ticket-123' });
    expect(approval.approved).toBe(true);
    const after = await bugFindingService.getFinding(finding.id);
    expect(after.human_approval_required).toBe(false);

    runTask.mockResolvedValue({ taskId: triage.fixTask.id, status: 'READY_FOR_PROMOTION', reasonCode: 'SMOKE_FAILED' });
    await simulateTaskStatus(triage.fixTask.id, 'READY_FOR_PROMOTION');
    const allowed = await bugLoop.runFixLoop(finding.id, { actor: 'TEST' });
    expect(allowed.executed).toBe(true);
    expect(runTask).toHaveBeenCalled();
    // Mesmo autorizado, o ciclo NÃO inventa FIXED sem as provas.
    expect(allowed.fixed).toBe(false);
  });
});
