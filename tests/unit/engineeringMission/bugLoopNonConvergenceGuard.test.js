'use strict';

/**
 * GUARDA DE NÃO-CONVERGÊNCIA DO LAÇO DE BUGS — regressão adversarial.
 *
 * DEFEITO REAL MEDIDO (2026-10-20, lote 5 do runner autoritativo): `runFixLoop` executava as duas
 * tentativas reais do Router para os MESMOS findings em `FIXING` em TODO tick do worker global
 * (302 ciclos em 900 s, `fixed=0`, `resumed=0`). Ela não contava nada de forma persistida
 * (`fix_attempts` só era incrementado uma vez, em `linkFixTask`), então nunca saía do vaivém e
 * consumia o runner compartilhado — a reprodução do finding NOVO da suíte falhava por concorrência
 * e a missão nunca era retomada. O laço parecia vivo e não produzia progresso.
 *
 * Aqui se prova a CONTRAMEDIDA: cada ciclo sem GREEN incrementa o contador persistido e, ao
 * atingir o limite, o finding vai para BLOCKED com dependência + ação humana mínima + evidência.
 * Nenhum teste deste arquivo "afrouxa" nada: o finding continua registrado e auditável.
 */

jest.mock('../../../api/services/engineeringMission/bugFindingService', () => ({
  getFinding: jest.fn(),
  recordFixNotGreen: jest.fn(),
  blockFinding: jest.fn(),
  makeEvidence: jest.fn((input) => ({ ...input, at: 'fixed-for-test' })),
  recordEvent: jest.fn(),
  markFixApplied: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(),
}));

jest.mock('../../../api/services/engineeringRouter/engineeringTaskService', () => ({
  getTask: jest.fn(),
  listAttempts: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugTriageService', () => ({
  canRunFixAutonomously: jest.fn(),
  triage: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/bugReproductionService', () => ({
  defaultRunner: {},
  buildPlan: jest.fn(),
  reproduce: jest.fn(),
}));

jest.mock('../../../api/services/engineeringMission/missionStoreService', () => ({
  getMission: jest.fn(),
}));

const bugFindingService = require('../../../api/services/engineeringMission/bugFindingService');
const { runTask } = require('../../../api/services/engineeringRouter/engineeringRouterService');
const engineeringTaskService = require('../../../api/services/engineeringRouter/engineeringTaskService');
const bugTriageService = require('../../../api/services/engineeringMission/bugTriageService');
const coordinator = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');
const engine = require('../../../engine/engineeringMission/bugFinding');

const FINDING_ID = '11111111-2222-3333-4444-555555555555';
const TASK_ID = '99999999-8888-7777-6666-555555555555';

function finding(overrides = {}) {
  return {
    id: FINDING_ID,
    status: 'FIXING',
    fix_task_id: TASK_ID,
    recurrence_count: 0,
    fix_attempts: 0,
    reproduction: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // `resetMocks: true` no jest.config reseta as implementações dos `jest.fn()` do factory;
  // por isso `makeEvidence` é reinstalado aqui (o resto é reconfigurado logo abaixo).
  bugFindingService.makeEvidence.mockImplementation((input) => ({ ...input }));
  bugFindingService.getFinding.mockResolvedValue(finding());
  bugTriageService.canRunFixAutonomously.mockResolvedValue({ allowed: true });
  engineeringTaskService.getTask.mockResolvedValue({ id: TASK_ID, status: 'RED' });
  engineeringTaskService.listAttempts.mockResolvedValue([]);
  runTask.mockResolvedValue({ status: 'RED', reasonCode: 'TESTS_FAILED' });
  bugFindingService.recordFixNotGreen.mockResolvedValue({ finding: finding(), fixAttempts: 1 });
  bugFindingService.blockFinding.mockResolvedValue({ finding: finding({ status: 'BLOCKED' }) });
});

describe('limite de não-convergência é declarado e finito', () => {
  test('MAX_FIX_NOT_CONVERGING é um inteiro positivo (nunca "infinito" por omissão)', () => {
    expect(Number.isInteger(coordinator.MAX_FIX_NOT_CONVERGING)).toBe(true);
    expect(coordinator.MAX_FIX_NOT_CONVERGING).toBeGreaterThan(0);
  });
});

describe('runFixLoop — contagem persistida do ciclo sem GREEN', () => {
  test('ciclo que termina em RED registra a tentativa no contador persistido', async () => {
    const result = await coordinator.runFixLoop(FINDING_ID, { actor: 'test' });

    expect(bugFindingService.recordFixNotGreen).toHaveBeenCalledTimes(1);
    const [calledId, payload] = bugFindingService.recordFixNotGreen.mock.calls[0];
    expect(calledId).toBe(FINDING_ID);
    expect(payload.taskStatus).toBe('RED');
    expect(result.fixed).toBe(false);
    expect(result.stage).toBe('NOT_GREEN');
  });

  test('CONTROLE NEGATIVO: com contador abaixo do limite NADA é bloqueado', async () => {
    bugFindingService.recordFixNotGreen.mockResolvedValue({ finding: finding(), fixAttempts: coordinator.MAX_FIX_NOT_CONVERGING - 1 });

    const result = await coordinator.runFixLoop(FINDING_ID, { actor: 'test' });

    expect(bugFindingService.blockFinding).not.toHaveBeenCalled();
    expect(result.stage).toBe('NOT_GREEN');
  });

  test('ao atingir o limite o finding vai para BLOCKED com dependência e ação humana mínima', async () => {
    bugFindingService.recordFixNotGreen.mockResolvedValue({
      finding: finding(), fixAttempts: coordinator.MAX_FIX_NOT_CONVERGING,
    });

    const result = await coordinator.runFixLoop(FINDING_ID, { actor: 'test' });

    expect(bugFindingService.blockFinding).toHaveBeenCalledTimes(1);
    const [calledId, payload] = bugFindingService.blockFinding.mock.calls[0];
    expect(calledId).toBe(FINDING_ID);
    expect(payload.dependency).toBe('BUG_FIX_NOT_CONVERGING');
    expect(typeof payload.minimumHumanAction).toBe('string');
    expect(payload.minimumHumanAction.length).toBeGreaterThan(20);
    expect(Array.isArray(payload.evidence)).toBe(true);
    expect(payload.evidence.length).toBeGreaterThan(0);
    // A evidência carrega o número real de ciclos: quem destravar não recomeça do zero.
    expect(payload.evidence[0].detail).toContain(String(coordinator.MAX_FIX_NOT_CONVERGING));

    expect(result.stage).toBe('BLOCKED_NOT_CONVERGING');
    expect(result.code).toBe('BUG_FIX_NOT_CONVERGING');
    expect(result.fixed).toBe(false);
  });

  test('a guarda NÃO depende de recurrence_count (que nunca incrementa em NOT_GREEN)', async () => {
    bugFindingService.getFinding.mockResolvedValue(finding({ recurrence_count: 0 }));
    bugFindingService.recordFixNotGreen.mockResolvedValue({
      finding: finding(), fixAttempts: coordinator.MAX_FIX_NOT_CONVERGING,
    });

    await coordinator.runFixLoop(FINDING_ID, { actor: 'test' });

    expect(bugFindingService.blockFinding).toHaveBeenCalledTimes(1);
  });

  test('o número de tentativas do Router por ciclo continua o declarado (não vira laço interno)', async () => {
    await coordinator.runFixLoop(FINDING_ID, { actor: 'test' });
    expect(runTask).toHaveBeenCalledTimes(coordinator.DEFAULT_MAX_FIX_ATTEMPTS);
  });
});

describe('countConsecutiveInconclusive — reprodução que não prova nada não repete para sempre', () => {
  const { countConsecutiveInconclusive } = engine;

  test('conta apenas a cauda de INCONCLUSIVE', () => {
    expect(countConsecutiveInconclusive([
      { outcome: 'INCONCLUSIVE' }, { outcome: 'REPRODUCED' }, { outcome: 'INCONCLUSIVE' }, { outcome: 'INCONCLUSIVE' },
    ])).toBe(2);
  });

  test('histórico vazio ou sem INCONCLUSIVE é 0 (nunca "prova" por ausência)', () => {
    expect(countConsecutiveInconclusive([])).toBe(0);
    expect(countConsecutiveInconclusive(null)).toBe(0);
    expect(countConsecutiveInconclusive([{ outcome: 'NOT_REPRODUCED' }])).toBe(0);
  });

  test('sequência inteira inconclusiva é contada por completo', () => {
    expect(countConsecutiveInconclusive([
      { outcome: 'INCONCLUSIVE' }, { outcome: 'INCONCLUSIVE' }, { outcome: 'INCONCLUSIVE' },
    ])).toBe(3);
  });
});
