'use strict';

/**
 * RETOMADA DA MISSÃO COM TASK ORIGINAL EM ESTADO TERMINAL — regressão adversarial.
 *
 * DEFEITO REAL MEDIDO (2026-10-20, lote 5 do runner autoritativo):
 * `resumeOriginalMission` decidia "criar task substituta" por uma lista LOCAL de estados terminais
 * (`['RED','GREEN','FAILED','CANCELLED','READY_FOR_PROMOTION']`) que OMITIA `BLOCKED` — estado
 * terminal do Router (`engine/engineeringRouter/constants.js::TERMINAL_STATES`) — e incluía
 * `FAILED`, que o Router nunca usa.
 *
 * Consequência medida: a task original terminava `BLOCKED` (ex.: `SANDBOX_UNAVAILABLE`), a retomada
 * caía no ramo "task ainda executável", chamava `startExecution`, recebia a MESMA task de volta
 * (idempotência) e registrava `replacementTaskId === originalTaskId`. A missão nunca voltava a
 * executar e a suíte falhava — corretamente — em
 * `expect(replacementTaskId).not.toBe(originalTaskId)`.
 */

jest.mock('../../../api/services/engineeringMission/missionStoreService', () => ({
  getMission: jest.fn(),
  updateMission: jest.fn(),
  mergeMissionJson: jest.fn(),
  linkTask: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionSourceService', () => ({
  ensureMissionSource: jest.fn(),
  resolveTaskSource: jest.fn(),
  reanchorTaskToCurrentSource: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionApprovalService', () => ({
  assertMissionExecutable: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/taskSpecBindingService', () => ({
  bindTaskToSpec: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringTaskService', () => ({
  getTask: jest.fn(),
  createTask: jest.fn(),
  listAttempts: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugReproductionService', () => ({
  defaultRunner: {}, buildPlan: jest.fn(), reproduce: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugTriageService', () => ({
  canRunFixAutonomously: jest.fn(), triage: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: jest.fn(),
  recordFixNotGreen: jest.fn(),
  blockFinding: jest.fn(),
  makeEvidence: jest.fn(),
  recordEvent: jest.fn(),
  markFixApplied: jest.fn(),
  listFindings: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionOrchestratorService', () => ({
  withMissionLease: jest.fn(),
  buildTaskContract: jest.fn(),
  startExecution: jest.fn(),
  runMissionTask: jest.fn(),
}));

const missionStore = require('../../../api/services/engineeringMission/missionStoreService');
const missionSourceService = require('../../../api/services/engineeringMission/missionSourceService');
const approvalService = require('../../../api/services/engineeringMission/missionApprovalService');
const taskSpecBinding = require('../../../api/services/engineeringMission/taskSpecBindingService');
const engineeringTaskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
const orchestrator = require('../../../api/services/engineeringMission/missionOrchestratorService');
const coordinator = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');

const MISSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const ORIGINAL_TASK_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const REPLACEMENT_TASK_ID = 'cccccccc-1111-2222-3333-444444444444';

function baseMocks(taskStatus) {
  missionStore.getMission.mockResolvedValue({
    id: MISSION_ID, status: 'FAILED', linked_task_id: ORIGINAL_TASK_ID, spec_version: 1, spec_hash: 'h',
  });
  missionStore.updateMission.mockResolvedValue({});
  missionStore.mergeMissionJson.mockResolvedValue({});
  missionStore.linkTask.mockResolvedValue({});
  engineeringTaskService.getTask.mockResolvedValue({ id: ORIGINAL_TASK_ID, status: taskStatus });
  engineeringTaskService.createTask.mockResolvedValue({ id: REPLACEMENT_TASK_ID });
  approvalService.assertMissionExecutable.mockResolvedValue({ spec: { id: 'spec-1' }, approval: {} });
  missionSourceService.ensureMissionSource.mockResolvedValue({});
  missionSourceService.resolveTaskSource.mockResolvedValue({ currentCommit: 'abc123', integrationBranch: 'eng/x', fence: 2 });
  missionSourceService.reanchorTaskToCurrentSource.mockResolvedValue({});
  taskSpecBinding.bindTaskToSpec.mockResolvedValue({});
  orchestrator.buildTaskContract.mockReturnValue({ objective: 'x' });
  orchestrator.withMissionLease.mockImplementation(async (_missionId, _opts, fn) => fn({ lease: null }));
  orchestrator.startExecution.mockResolvedValue({ task: { id: ORIGINAL_TASK_ID } });
  orchestrator.runMissionTask.mockResolvedValue({ result: { status: 'GREEN' } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resumeOriginalMission — terminal vem da fonte canônica do Router', () => {
  test.each(['BLOCKED', 'RED', 'CANCELLED', 'READY_FOR_PROMOTION'])(
    'task original em %s cria TASK SUBSTITUTA (nunca reusa a original)',
    async (status) => {
      baseMocks(status);

      const result = await coordinator.resumeOriginalMission({ missionId: MISSION_ID, findingId: 'f-1' });

      expect(engineeringTaskService.createTask).toHaveBeenCalledTimes(1);
      expect(result.replacementTaskId).toBe(REPLACEMENT_TASK_ID);
      expect(result.replacementTaskId).not.toBe(ORIGINAL_TASK_ID);
      expect(result.decision).toBe('REPLACE_TASK_RESUME_PHASE');
      expect(result.lineage.supersededTaskId).toBe(ORIGINAL_TASK_ID);
    },
  );

  test('CONTROLE: task ainda NÃO terminal pode ser retomada pelo orquestrador (mesma task)', async () => {
    baseMocks('TESTING');

    const result = await coordinator.resumeOriginalMission({ missionId: MISSION_ID, findingId: 'f-1' });

    expect(engineeringTaskService.createTask).not.toHaveBeenCalled();
    expect(orchestrator.startExecution).toHaveBeenCalledTimes(1);
    expect(result.replacementTaskId).toBe(ORIGINAL_TASK_ID);
  });

  test('a decisão usa a MESMA definição de terminal do Router (nada de lista local divergente)', () => {
    const { TERMINAL_STATES } = require('../../../engine/engineeringRouter/constants');
    expect(TERMINAL_STATES).toContain('BLOCKED');
    // Se este contrato mudar, a retomada precisa mudar junto — é o ponto do teste.
    expect(TERMINAL_STATES.slice().sort()).toEqual(['BLOCKED', 'CANCELLED', 'GREEN', 'READY_FOR_PROMOTION', 'RED']);
  });
});
