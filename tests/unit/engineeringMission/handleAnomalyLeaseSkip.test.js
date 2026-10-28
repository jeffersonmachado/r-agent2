'use strict';

/**
 * `handleAnomaly` NÃO PODE DESREFERENCIAR REPRODUÇÃO RECUSADA — regressão adversária (2026-10-25).
 *
 * A posse por lease fez `reproduce` poder devolver `{ outcome: 'SKIPPED_LEASE_HELD', skipped: true,
 * finding: null }` quando outro worker detém o finding. `handleAnomaly` fazia `finding =
 * reproduction.finding` e em seguida `finding.status` ⇒ `TypeError`, derrubando o caminho de anomalia
 * (medido pelo revisor independente com a recusa injetada).
 *
 * Aqui a recusa é injetada de propósito: é o ÚNICO jeito de exercitar a borda sem corrida real.
 */

jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: jest.fn(),
  recordEvent: jest.fn(async () => ({})),
  makeEvidence: jest.fn((e) => e),
  registerFinding: jest.fn(),
  withFindingLeaseOwned: async (id, opcoes, fn) => fn({ lease: (opcoes && opcoes.lease) || null, owned: false }),
}));

jest.mock('../../../api/services/engineeringMission/bugReproductionService', () => ({
  defaultRunner: {},
  buildPlan: jest.fn(),
  reproduce: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugTriageService', () => ({
  canRunFixAutonomously: jest.fn(),
  triage: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionStoreService', () => ({
  getMission: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(),
}));

const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');
const bugReproductionService = require('../../../api/services/engineeringMission/bugReproductionService');
const coordinator = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');

const FINDING = { id: 'f-anomalia', status: 'SUSPECTED', mission_id: null, fix_task_id: null };

beforeEach(() => {
  bugFindingService.registerFinding.mockResolvedValue({ finding: FINDING, deduplicated: false, recurrence: false });
  bugReproductionService.buildPlan.mockReturnValue({ kind: 'COMMAND', command: 'npx jest x', rationale: null });
});

describe('handleAnomaly — recusa por posse não derruba o caminho de anomalia', () => {
  test('reprodução SKIPPED_LEASE_HELD devolve relatório marcado, sem TypeError', async () => {
    bugReproductionService.reproduce.mockResolvedValue({
      outcome: 'SKIPPED_LEASE_HELD', skipped: true, code: 'FINDING_LEASE_HELD_BY_OTHER_WORKER', finding: null,
    });

    const report = await coordinator.handleAnomaly({ title: 'anomalia sob posse alheia' }, { actor: 'TEST' });

    expect(report.skipped).toBe(true);
    expect(report.outcome).toBe('SKIPPED_LEASE_HELD');
    expect(report.confirmed).toBe(false);
    expect(report.triaged).toBeNull();
    expect(report.fix).toBeNull();
  });

  test('controle positivo: reprodução normal segue confirmando e triando', async () => {
    const confirmado = { ...FINDING, status: 'CONFIRMED' };
    bugReproductionService.reproduce.mockResolvedValue({ outcome: 'REPRODUCED', finding: confirmado });
    require('../../../api/services/engineeringMission/bugTriageService').triage.mockResolvedValue({
      finding: confirmado, requiresNonApplicationAction: true,
    });

    const report = await coordinator.handleAnomaly({ title: 'anomalia normal' }, { actor: 'TEST' });

    expect(report.skipped).toBeUndefined();
    expect(report.reproduced).toBe('REPRODUCED');
    expect(report.confirmed).toBe(true);
    expect(report.outcome).toBe('CONFIRMED_NON_APPLICATION_ACTION');
  });
});
