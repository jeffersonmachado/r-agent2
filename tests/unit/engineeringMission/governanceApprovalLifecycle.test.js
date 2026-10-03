'use strict';

/**
 * tests/unit/engineeringMission/governanceApprovalLifecycle.test.js
 *
 * GOVERNANCE_CHANGE_APPROVAL_LIFECYCLE + POST_APPROVAL_AUTONOMOUS_RESUME.
 *
 * O QUE É PROVADO (a ordem e o estado, que é onde o defeito vivia):
 *
 *   GOV_LC_01  baseline de governança VIOLADO ⇒ o finding NÃO é declarado FIXED; permanece FIXING
 *              com `blocking_reason` persistido (o estado não pode mentir "corrigido");
 *   GOV_LC_02  o mesmo caso registra o CHECKPOINT (patch/testes/review já concluídos) — é o que
 *              permite retomar sem reexecutar o coder;
 *   GOV_LC_03  baseline OK ⇒ fecha o fluxo normal: markFixed → regressão → close;
 *   GOV_LC_04  após o aval humano (segundo ciclo, mesmo finding) o worker CONTINUA do checkpoint e
 *              fecha — sem intervenção humana adicional e sem `POST /sweep`;
 *   GOV_LC_05  `canRunFixAutonomously` bloqueado continua bloqueado (não é furável).
 *
 * DEFEITO ELIMINADO (2026-10-03): `runFixLoop` chamava `markFixed` ANTES de verificar o baseline de
 * governança. O finding virava `FIXED` — "corrigido" — aguardando aval humano, e como
 * `runBugLoopSweep` só varre CONFIRMED/FIXING, o finding ficava ÓRFÃO: a aprovação acontecia e nada
 * nunca retomava o trabalho.
 */

jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: jest.fn(),
  recordEvent: jest.fn(async () => ({})),
  makeEvidence: jest.fn((e) => e),
  markFixApplied: jest.fn(async () => ({})),
  markPendingGovernanceApproval: jest.fn(async (id) => ({ id, status: 'FIXING' })),
  clearGovernanceBlock: jest.fn(async () => ({})),
  markFixed: jest.fn(async () => ({ finding: { id: 'f1', status: 'FIXED' }, idempotent: false })),
  markRegressionValidated: jest.fn(async () => ({ finding: { id: 'f1', status: 'REGRESSION_VALIDATED' } })),
  closeFinding: jest.fn(async () => ({ finding: { id: 'f1', status: 'CLOSED' } })),
  blockFinding: jest.fn(async () => ({})),
  listFindings: jest.fn(async () => []),
  acquireFindingLease: jest.fn(),
  releaseFindingLease: jest.fn(async () => ({})),
  heartbeatFindingLease: jest.fn(async () => ({})),
  getFindingMemory: jest.fn(async () => ({ known: false, priorFindings: [], priorRegressionCommands: [] })),
}));

jest.mock('../../../api/services/engineeringMission/bugTriageService', () => ({
  canRunFixAutonomously: jest.fn(async () => ({ allowed: true })),
  verifySelfModificationBaseline: jest.fn(),
  triage: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugReproductionService', () => ({
  defaultRunner: {},
  buildPlan: jest.fn(),
  reproduce: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(async () => ({ status: 'GREEN', attemptId: 'attempt-1' })),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringTaskService', () => ({
  getTask: jest.fn(async () => ({ id: 'task-1', status: 'GREEN' })),
  listAttempts: jest.fn(async () => [{ id: 'attempt-1' }]),
  listTestRuns: jest.fn(),
  listReviews: jest.fn(),
  listRegressionRuns: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionStoreService', () => ({}));
jest.mock('../../../api/services/engineeringMission/missionSourceService', () => ({}));

// O coordenador lê REVIEW e REGRESSÃO dos models reais (não do task service): sem este dublê o
// teste morreria em "Sequelize não inicializado" em vez de medir o ciclo de vida.
let mockReviewRows = [];
let mockRegressionRows = [];
jest.mock('../../../api/db/models', () => ({
  getEngineeringReview: () => ({
    findAll: async () => mockReviewRows.map((row) => ({ get: () => row })),
  }),
  getEngineeringRegressionRun: () => ({
    findAll: async () => mockRegressionRows.map((row) => ({ get: () => row })),
  }),
}));

const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');
const bugTriageService = require('../../../api/services/engineeringMission/bugTriageService');
const coordinator = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');

/** Fix task já GREEN, com reprodução e review aprovados — as três provas objetivas. */
function greenTaskEvidence() {
  const taskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
  taskService.listTestRuns.mockResolvedValue([
    { id: 't1', command: 'npm test -- x', status: 'PASS', exit_code: 0, result: 'PASS' },
  ]);
  taskService.listReviews.mockResolvedValue([{ id: 'r1', decision: 'APPROVE', reviewer: 'revisor-1' }]);
  taskService.listRegressionRuns.mockResolvedValue([]);
  taskService.getTask.mockResolvedValue({ id: 'task-1', status: 'GREEN' });
  taskService.listAttempts.mockResolvedValue([{ id: 'attempt-1' }]);
}

function selfModificationFinding(overrides = {}) {
  return {
    id: 'f1',
    mission_id: 'm1',
    fix_task_id: 'task-1',
    status: 'FIXING',
    self_modification: true,
    recurrence_count: 0,
    reproduction: { command: 'npm test -- x', expect: 'FAIL' },
    triage: { requiresIndependentReviewer: true },
    ...overrides,
  };
}

// `jest.config.cjs` tem `resetMocks: true`: as implementações dos dublês de módulo são APAGADAS
// antes de cada teste. Por isso os defaults são reinstalados aqui — um teste que dependesse do
// default declarado no `jest.mock(...)` mediria `undefined`, não o comportamento.
beforeEach(() => {
  const taskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
  const { runTask } = require('../../../api/services/engineeringRouter/engineeringRouterService');

  bugFindingService.getFinding.mockResolvedValue(null);
  bugFindingService.recordEvent.mockResolvedValue({});
  bugFindingService.makeEvidence.mockImplementation((e) => e);
  bugFindingService.markFixApplied.mockResolvedValue({});
  bugFindingService.markPendingGovernanceApproval.mockImplementation(async (id) => ({ id, status: 'FIXING' }));
  bugFindingService.clearGovernanceBlock.mockResolvedValue({});
  bugFindingService.markFixed.mockResolvedValue({ finding: { id: 'f1', status: 'FIXED' }, idempotent: false });
  bugFindingService.markRegressionValidated.mockResolvedValue({ finding: { id: 'f1', status: 'REGRESSION_VALIDATED' } });
  bugFindingService.closeFinding.mockResolvedValue({ finding: { id: 'f1', status: 'CLOSED' } });
  bugFindingService.blockFinding.mockResolvedValue({});
  bugFindingService.listFindings.mockResolvedValue([]);
  bugFindingService.getFindingMemory.mockResolvedValue({ known: false, priorFindings: [], priorRegressionCommands: [] });

  bugTriageService.canRunFixAutonomously.mockResolvedValue({ allowed: true });
  bugTriageService.verifySelfModificationBaseline.mockReset();
  bugTriageService.triage.mockResolvedValue({});

  runTask.mockResolvedValue({ status: 'GREEN', attemptId: 'attempt-1' });

  mockReviewRows = [{ id: 'r1', decision: 'APPROVE', reviewer: 'revisor-1', task_id: 'task-1' }];
  mockRegressionRows = [];

  greenTaskEvidence();
});

describe('GOVERNANCE_CHANGE_APPROVAL_LIFECYCLE', () => {
  test('GOV_LC_01 baseline VIOLADO ⇒ NÃO declara FIXED; permanece FIXING com motivo de bloqueio', async () => {
    bugFindingService.getFinding.mockResolvedValue(selfModificationFinding());
    bugTriageService.verifySelfModificationBaseline.mockResolvedValue({
      ok: false,
      checked: true,
      code: 'GOVERNANCE_BASELINE_VIOLATION',
      reason: 'o fix alterou as próprias regras de julgamento',
      diff: { changed: true, files: { modified: ['config/engineering-gates.json'] } },
    });

    const result = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });

    // O estado NÃO mente: nada de FIXED enquanto aguarda aval humano.
    expect(bugFindingService.markFixed).not.toHaveBeenCalled();
    expect(result.fixed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.stage).toBe('AWAITING_GOVERNANCE_APPROVAL');
    expect(result.blockingReason).toBe('GOVERNANCE_APPROVAL_REQUIRED');
    // O bloqueio é PERSISTIDO (persistência é o que o worker lê depois).
    expect(bugFindingService.markPendingGovernanceApproval).toHaveBeenCalledTimes(1);
    const [, payload] = bugFindingService.markPendingGovernanceApproval.mock.calls[0];
    expect(payload.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
  });

  test('GOV_LC_02 o bloqueio persiste o CHECKPOINT (patch/testes/review já feitos)', async () => {
    bugFindingService.getFinding.mockResolvedValue(selfModificationFinding());
    bugTriageService.verifySelfModificationBaseline.mockResolvedValue({
      ok: false, checked: true, code: 'GOVERNANCE_BASELINE_VIOLATION', reason: 'x', diff: { changed: true },
    });

    const result = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });

    // Evidência de fix já aplicado foi registrada ANTES do bloqueio (não se perde trabalho feito).
    expect(bugFindingService.markFixApplied).toHaveBeenCalledTimes(1);
    expect(result.checkpoint).toMatchObject({ fixTaskId: 'task-1', fixApplied: true });
  });

  test('GOV_LC_03 baseline INALTERADO segue o fluxo normal: FIXED → regressão → CLOSE', async () => {
    bugFindingService.getFinding.mockResolvedValue(selfModificationFinding());
    bugTriageService.verifySelfModificationBaseline.mockResolvedValue({ ok: true, checked: true, code: null, diff: { changed: false } });
    mockRegressionRows = [{ id: 'rg-1', task_id: 'task-1', commands: ['npm test'], result: 'PASS' }];

    const result = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });

    expect(bugFindingService.markPendingGovernanceApproval).not.toHaveBeenCalled();
    expect(bugFindingService.markFixed).toHaveBeenCalledTimes(1);
    expect(bugFindingService.markRegressionValidated).toHaveBeenCalledTimes(1);
    expect(bugFindingService.closeFinding).toHaveBeenCalledTimes(1);
    expect(result.closed).toBe(true);
  });

  test('GOV_LC_04 pós-aval (2º ciclo, mesmo finding) CONTINUA do checkpoint e FECHA sem novo coder', async () => {
    const taskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
    const { runTask } = require('../../../api/services/engineeringRouter/engineeringRouterService');

    // Ciclo 1: bloqueado por governança.
    bugFindingService.getFinding.mockResolvedValue(selfModificationFinding());
    bugTriageService.verifySelfModificationBaseline.mockResolvedValue({
      ok: false, checked: true, code: 'GOVERNANCE_BASELINE_VIOLATION', reason: 'x', diff: { changed: true },
    });
    const blocked = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });
    expect(blocked.stage).toBe('AWAITING_GOVERNANCE_APPROVAL');

    // Ciclo 2 (o MESMO worker periódico re-seleciona o finding, que continua FIXING): o aval
    // humano já foi persistido, então a autorização passa a ser concedida.
    bugTriageService.verifySelfModificationBaseline.mockResolvedValue({
      ok: true, checked: true, authorized: true, code: 'GOVERNANCE_BASELINE_HUMAN_AUTHORIZED', diff: { changed: true },
    });
    mockRegressionRows = [{ id: 'rg-1', task_id: 'task-1', commands: ['npm test'], result: 'PASS' }];

    const resumed = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });

    expect(resumed.closed).toBe(true);
    expect(bugFindingService.markFixed).toHaveBeenCalledTimes(1);
    expect(bugFindingService.closeFinding).toHaveBeenCalledTimes(1);
    // CONTINUA do checkpoint: o Router foi retomado (task já GREEN, execução idempotente), sem
    // exigir um segundo `POST /sweep` nem um novo ciclo de coder.
    expect(runTask).toHaveBeenCalled();
    // O bloqueio anterior não é esquecido — ele é auditável no finding.
    expect(bugFindingService.markPendingGovernanceApproval).toHaveBeenCalledTimes(1);
  });

  test('GOV_LC_05 fix autônomo BLOQUEADO por policy continua bloqueado (não é furável)', async () => {
    bugFindingService.getFinding.mockResolvedValue(selfModificationFinding({ human_approval_required: true, auto_approval_forbidden: true }));
    bugTriageService.canRunFixAutonomously.mockResolvedValue({
      allowed: false,
      code: 'SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED',
      reason: 'aprovação humana obrigatória',
      minimumHumanAction: 'POST /engineering/findings/:id/approve-self-modification',
    });

    const result = await coordinator.runFixLoop('f1', { actor: 'SYSTEM:BUG_LOOP' });

    expect(result.blocked).toBe(true);
    expect(result.executed).toBe(false);
    expect(bugFindingService.markFixApplied).not.toHaveBeenCalled();
    expect(bugFindingService.markFixed).not.toHaveBeenCalled();
  });
});
