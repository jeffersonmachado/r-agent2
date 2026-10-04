'use strict';

/**
 * tests/unit/engineeringMission/sourceStaleAutomaticReplan.test.js
 *
 * STALE_CANDIDATE_AUTOMATIC_REPLAN — o COMPORTAMENTO que faltava.
 *
 * DEFEITO ELIMINADO (2026-10-03): a task stale terminava `READY_FOR_PROMOTION` com
 * `reasonCode=STALE_CANDIDATE`; `hookMissionFailure` classificava corretamente como `MISSION_SOURCE`
 * (não abre bug de aplicação) — e PARAVA AÍ. Como `MISSION_SOURCE` está em
 * `NON_APPLICATION_CATEGORIES`, nenhuma fix task nascia e NENHUM replan acontecia: a missão ficava
 * `EXECUTING` sem atividade. A classificação estava certa; a ação não existia.
 *
 * Aqui se prova o comportamento e as TRÊS fronteiras:
 *   STALE-01 cleanly reapply        → REPLAN automático: task substituta ancorada no commit CORRENTE
 *                                     da fonte, executada pelo caminho canônico;
 *   STALE-02 patch conflita         → SOURCE_REPLAN_CONFLICT, sem sucesso falso e sem reaplicar de novo;
 *   STALE-03 fonte avança de novo   → retry LIMITADO e depois EXHAUSTED (nunca laço infinito);
 *   + casos de borda: não-falha-de-fonte não replaneja; o contador sobrevive a restart (persistido).
 */

jest.mock('../../../api/services/engineeringMission/missionStoreService', () => ({
  getMission: jest.fn(),
  mergeMissionJson: jest.fn(async () => ({})),
  linkTask: jest.fn(async () => ({})),
  updateMission: jest.fn(async () => ({})),
}));

jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: jest.fn(async () => null),
  recordEvent: jest.fn(async () => ({})),
  makeEvidence: jest.fn((e) => e),
  registerFinding: jest.fn(async () => ({ id: 'f-new' })),
  listFindings: jest.fn(async () => []),
  findByFixTaskId: jest.fn(async () => null),
  acquireFindingLease: jest.fn(),
  releaseFindingLease: jest.fn(async () => ({})),
  heartbeatFindingLease: jest.fn(async () => ({})),
  getFindingMemory: jest.fn(async () => ({ known: false, priorFindings: [], priorRegressionCommands: [] })),
}));

jest.mock('../../../api/services/engineeringMission/bugReproductionService', () => ({
  defaultRunner: {}, buildPlan: jest.fn(), reproduce: jest.fn(),
}));
jest.mock('../../../api/services/engineeringMission/bugTriageService', () => ({
  canRunFixAutonomously: jest.fn(async () => ({ allowed: true })),
  verifySelfModificationBaseline: jest.fn(),
  triage: jest.fn(),
}));
jest.mock('../../../api/db/models', () => ({
  getEngineeringReview: () => ({ findAll: async () => [] }),
  getEngineeringRegressionRun: () => ({ findAll: async () => [] }),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringTaskService', () => ({
  getTask: jest.fn(),
  createTask: jest.fn(),
  listAttempts: jest.fn(async () => []),
  listTestRuns: jest.fn(async () => []),
  listReviews: jest.fn(async () => []),
  listRegressionRuns: jest.fn(async () => []),
  updateTaskFields: jest.fn(async () => ({})),
}));
jest.mock('../../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(async () => ({ status: 'GREEN' })),
}));

jest.mock('../../../api/services/engineeringMission/missionApprovalService', () => ({
  assertMissionExecutable: jest.fn(async () => ({ spec: { version: 1 }, approval: { state: 'APPROVED' } })),
}));
jest.mock('../../../api/services/engineeringMission/taskSpecBindingService', () => ({
  bindTaskToSpec: jest.fn(async () => ({})),
}));
jest.mock('../../../api/services/engineeringMission/missionSourceService', () => ({
  ensureMissionSource: jest.fn(async () => ({})),
  resolveTaskSource: jest.fn(async () => ({ currentCommit: 'M2', integrationBranch: 'engineering/missions/m1', fence: 1 })),
  reanchorTaskToCurrentSource: jest.fn(async () => ({ reanchored: true })),
}));
jest.mock('../../../api/services/engineeringMission/missionOrchestratorService', () => ({
  withMissionLease: jest.fn(async (missionId, lease, fn) => fn({ lease: { token: 't', fence: 1 } })),
  buildTaskContract: jest.fn((spec, opts) => ({ ...opts, title: 'replan task' })),
  runMissionTask: jest.fn(),
}));

const missionStore = require('../../../api/services/engineeringMission/missionStoreService');
const engineeringTaskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
const orchestrator = require('../../../api/services/engineeringMission/missionOrchestratorService');
const sourceService = require('../../../api/services/engineeringMission/missionSourceService');
const coordinator = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');

const MISSION_ID = 'm-1';
const STALE_TASK_ID = 't-stale';
const STALE_RESULT = { status: 'READY_FOR_PROMOTION', reasonCode: 'STALE_CANDIDATE' };

/** Missão com task ORIGINAL terminal: é o caminho de task substituta dentro de `resumeOriginalMission`. */
function missionWith(overrides = {}) {
  return {
    id: MISSION_ID,
    status: 'EXECUTING',
    linked_task_id: STALE_TASK_ID,
    spec_version: 1,
    spec_hash: 'h1',
    resume_metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  // `resetMocks: true` no jest.config.cjs apaga as implementações de fábrica: reinstalar aqui.
  missionStore.getMission.mockResolvedValue(missionWith());
  missionStore.mergeMissionJson.mockResolvedValue({});
  missionStore.linkTask.mockResolvedValue({});
  missionStore.updateMission.mockResolvedValue({});

  engineeringTaskService.getTask.mockResolvedValue({ id: STALE_TASK_ID, status: 'READY_FOR_PROMOTION' });
  engineeringTaskService.createTask.mockResolvedValue({ id: 't-replan' });

  sourceService.ensureMissionSource.mockResolvedValue({});
  sourceService.resolveTaskSource.mockResolvedValue({ currentCommit: 'M2', integrationBranch: 'engineering/missions/m1', fence: 1 });
  sourceService.reanchorTaskToCurrentSource.mockResolvedValue({ reanchored: true });

  orchestrator.withMissionLease.mockImplementation(async (missionId, lease, fn) => fn({ lease: { token: 't', fence: 1 } }));
  orchestrator.buildTaskContract.mockImplementation((spec, opts) => ({ ...opts, title: 'replan task' }));
  orchestrator.runMissionTask.mockResolvedValue({ result: { status: 'GREEN' }, mission: {} });
});

describe('STALE_CANDIDATE_AUTOMATIC_REPLAN', () => {
  test('STALE-01 patch reaplica limpo ⇒ REPLAN automático sobre o commit CORRENTE da fonte', async () => {
    const out = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID, taskId: STALE_TASK_ID, result: STALE_RESULT, actor: 'SYSTEM:MISSION',
    });

    expect(out.replanned).toBe(true);
    expect(out.attempt).toBe(1);
    expect(out.attempt).toBeLessThanOrEqual(out.maxAttempts);
    expect(out.status).toBe('GREEN');
    expect(out.state).toBe('REPLAN_SUCCEEDED');

    // A task substituta nasce do commit CORRENTE da fonte (M2), não do commit original — é o
    // "reancorar e reaplicar". Sem isto, o replan reproduziria o mesmo stale.
    expect(sourceService.resolveTaskSource).toHaveBeenCalledWith(MISSION_ID);
    expect(engineeringTaskService.createTask).toHaveBeenCalledTimes(1);
    const contract = engineeringTaskService.createTask.mock.calls[0][0];
    expect(contract.sourceCommit).toBe('M2');
    expect(contract.sourceRef).toBe('engineering/missions/m1');
    expect(sourceService.reanchorTaskToCurrentSource).toHaveBeenCalledWith('t-replan', { actor: 'SYSTEM:MISSION' });

    // O contador é PERSISTIDO (sobrevive a restart, é o que torna o limite efetivo entre processos).
    // NÃO-RECURSÃO: a execução interna é instruída a não decidir de novo. Sem esta trava, o replan
    // se chamaria recursivamente e o contador de tentativas nunca limitaria nada de forma observável.
    expect(orchestrator.runMissionTask).toHaveBeenCalledTimes(1);
    expect(orchestrator.runMissionTask.mock.calls[0][1].allowSourceReplan).toBe(false);

    const persisted = missionStore.mergeMissionJson.mock.calls
      .map(([, patch]) => patch.resume.sourceReplan)
      .filter(Boolean);
    expect(persisted.some((s) => s.state === 'REPLAN_SUCCEEDED' && s.attempts === 1)).toBe(true);
  });

  test('STALE-02 reaplicação CONFLITA ⇒ SOURCE_REPLAN_CONFLICT, sem sucesso falso e sem reaplicar', async () => {
    const out = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID,
      taskId: STALE_TASK_ID,
      result: { status: 'READY_FOR_PROMOTION', reasonCode: 'STALE_CANDIDATE', missionIntegration: { code: 'MISSION_SOURCE_REPLAN_CONFLICT' } },
      actor: 'SYSTEM:MISSION',
    });

    expect(out.replanned).toBe(false);
    expect(out.state).toBe('SOURCE_REPLAN_CONFLICT');
    expect(out.code).toBe('MISSION_SOURCE_REPLAN_CONFLICT');
    // Conflito NÃO se resolve reaplicando: nenhum efeito foi produzido.
    expect(engineeringTaskService.createTask).not.toHaveBeenCalled();
    expect(orchestrator.runMissionTask).not.toHaveBeenCalled();
  });

  test('STALE-03 a fonte avança de novo ⇒ retry LIMITADO e depois EXHAUSTED (nunca laço infinito)', async () => {
    // O replan "funciona" mas o resultado continua stale — o cenário que geraria laço infinito.
    orchestrator.runMissionTask.mockResolvedValue({ result: { status: 'READY_FOR_PROMOTION', reasonCode: 'STALE_CANDIDATE' }, mission: {} });

    const first = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID, taskId: STALE_TASK_ID, result: STALE_RESULT, actor: 'SYSTEM:MISSION',
    });
    expect(first.replanned).toBe(true);
    expect(first.attempt).toBe(1);

    // Segunda tentativa: o contador PERSISTIDO é a autoridade (simula outro processo/restart).
    missionStore.getMission.mockResolvedValue(missionWith({
      linked_task_id: 't-replan',
      resume_metadata: { sourceReplan: { attempts: 1, state: 'REPLAN_RAN' } },
    }));
    engineeringTaskService.getTask.mockResolvedValue({ id: 't-replan', status: 'READY_FOR_PROMOTION' });
    engineeringTaskService.createTask.mockResolvedValue({ id: 't-replan-2' });

    const second = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID, taskId: 't-replan', result: STALE_RESULT, actor: 'SYSTEM:MISSION',
    });
    expect(second.replanned).toBe(true);
    expect(second.attempt).toBe(2);

    // Terceira: o limite foi atingido ⇒ PARAR de insistir, com estado declarado.
    missionStore.getMission.mockResolvedValue(missionWith({
      linked_task_id: 't-replan-2',
      resume_metadata: { sourceReplan: { attempts: 2, state: 'REPLAN_RAN' } },
    }));

    const attemptsBefore = engineeringTaskService.createTask.mock.calls.length;
    const third = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID, taskId: 't-replan-2', result: STALE_RESULT, actor: 'SYSTEM:MISSION',
    });

    expect(third.replanned).toBe(false);
    expect(third.state).toBe('SOURCE_REPLAN_EXHAUSTED');
    expect(third.code).toBe('MISSION_SOURCE_REPLAN_EXHAUSTED');
    // NENHUM efeito novo: o laço parou.
    expect(engineeringTaskService.createTask.mock.calls.length).toBe(attemptsBefore);
  });

  test('falha que NÃO é da camada de fonte não replaneja (não sequestra bug de aplicação)', async () => {
    const out = await coordinator.maybeReplanAfterSourceFailure({
      missionId: MISSION_ID,
      taskId: STALE_TASK_ID,
      result: { status: 'RED', reasonCode: 'TESTS_FAILED' },
      actor: 'SYSTEM:MISSION',
    });

    expect(out.replanned).toBe(false);
    expect(out.reason).toBe('NOT_SOURCE_FAILURE');
    expect(engineeringTaskService.createTask).not.toHaveBeenCalled();
  });

});
