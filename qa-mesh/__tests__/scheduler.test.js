'use strict';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(() => {
    throw new Error('missing');
  }),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// isMeshAlreadyRunning() executa `ps aux | grep meshRunner\.js` de verdade
// (execSync não era mockado): com um mesh real rodando na máquina, o teste
// "execução agendada desabilita escrita canônica" falhava de forma intermitente
// (runScheduledMesh retornava scheduler_locked e runMesh nunca era chamado).
// Mock hermético: nenhum processo meshRunner vivo por padrão.
jest.mock('child_process', () => ({
  execSync: jest.fn(() => ''),
}));

jest.mock('../meshRunner', () => ({
  loadRegistry: jest.fn(() => []),
  runMesh: jest.fn(),
}));

const fs = require('fs');
const meshRunner = require('../meshRunner');
const { selectScenariosForSchedule, runScheduledMesh, setSchedulerEnabled, buildScheduleStatus, startScheduler } = require('../meshScheduler');

describe('qa-mesh/meshScheduler', () => {
  const registry = [
    { id: 'smoke-core', type: 'smoke', criticality: 'blocking' },
    { id: 'regression-beauty', type: 'regression', criticality: 'medium' },
    { id: 'technical-pbx', type: 'technical', criticality: 'blocking' },
  ];
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    meshRunner.loadRegistry.mockReturnValue(registry);
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('seleciona apenas smoke para schedule smoke', () => {
    expect(selectScenariosForSchedule('smoke', registry).map((item) => item.id)).toEqual(['smoke-core']);
  });

  test('seleciona apenas blocking para schedule critical', () => {
    expect(selectScenariosForSchedule('critical', registry).map((item) => item.id)).toEqual([
      'smoke-core',
      'technical-pbx',
    ]);
  });

  test('regression executa toda a malha', () => {
    expect(selectScenariosForSchedule('regression', registry).map((item) => item.id)).toEqual([
      'smoke-core',
      'regression-beauty',
      'technical-pbx',
    ]);
  });

  test('não executa scheduler quando pipeline oficial está ativo', async () => {
    fs.existsSync.mockReturnValue(true);

    const result = await runScheduledMesh('critical');

    expect(result).toMatchObject({
      skipped: true,
      reason: 'pipeline_active',
    });
    expect(meshRunner.runMesh).not.toHaveBeenCalled();
  });

  test('execução agendada desabilita escrita canônica', async () => {
    meshRunner.runMesh.mockResolvedValue({
      executionId: 'mesh-scheduled-1',
      summary: { goNoGo: 'GO' },
    });

    await runScheduledMesh('critical');

    expect(meshRunner.runMesh).toHaveBeenCalledWith(expect.objectContaining({
      executionOrigin: 'scheduler',
      executionKind: 'critical',
      autoReplayOnFailure: true,
      writeCanonicalOutputs: false,
      scenarioIds: ['smoke-core', 'technical-pbx'],
    }));
  });
});

describe('qa-mesh/meshScheduler — setSchedulerEnabled', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.QA_MESH_SCHEDULER_DISABLED;
    delete process.env.QA_MESH_SCHEDULER_DISABLED;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    setSchedulerEnabled(false);
    if (originalEnv === undefined) delete process.env.QA_MESH_SCHEDULER_DISABLED;
    else process.env.QA_MESH_SCHEDULER_DISABLED = originalEnv;
  });

  test('desativa o scheduler e reflete no status', () => {
    const status = setSchedulerEnabled(false);
    expect(status.enabled).toBe(false);
    expect(buildScheduleStatus().enabled).toBe(false);
  });

  test('reativa o scheduler e reflete no status', () => {
    setSchedulerEnabled(false);
    const status = setSchedulerEnabled(true);
    expect(status.enabled).toBe(true);
    expect(buildScheduleStatus().enabled).toBe(true);
  });

  test('env var QA_MESH_SCHEDULER_DISABLED mantém desligado (fail-closed)', () => {
    process.env.QA_MESH_SCHEDULER_DISABLED = 'true';
    const status = setSchedulerEnabled(true);
    expect(status.enabled).toBe(false);
  });

  test('altera a frequência e reflete no status', () => {
    const status = setSchedulerEnabled(true, '1h');
    expect(status.enabled).toBe(true);
    expect(status.frequency.key).toBe('1h');
    expect(status.frequency.label).toBe('A cada 1 hora');
  });

  test('ignora chave de frequência inválida', () => {
    setSchedulerEnabled(true, '15min');
    const status = setSchedulerEnabled(true, 'inexistente');
    expect(status.frequency.key).toBe('15min');
  });
});

describe('qa-mesh/meshScheduler — startScheduler (habilitação explícita)', () => {
  let originalEnabledEnv;
  let originalDisabledEnv;

  beforeEach(() => {
    originalEnabledEnv = process.env.QA_MESH_SCHEDULER_ENABLED;
    originalDisabledEnv = process.env.QA_MESH_SCHEDULER_DISABLED;
    delete process.env.QA_MESH_SCHEDULER_ENABLED;
    delete process.env.QA_MESH_SCHEDULER_DISABLED;
  });

  afterEach(() => {
    if (originalEnabledEnv === undefined) delete process.env.QA_MESH_SCHEDULER_ENABLED;
    else process.env.QA_MESH_SCHEDULER_ENABLED = originalEnabledEnv;
    if (originalDisabledEnv === undefined) delete process.env.QA_MESH_SCHEDULER_DISABLED;
    else process.env.QA_MESH_SCHEDULER_DISABLED = originalDisabledEnv;
  });

  test('permanece desligado por padrão (sem enabled:true nem env opt-in)', () => {
    const status = startScheduler();
    expect(status).toMatchObject({ enabled: false, reason: 'not_explicitly_enabled' });
  });

  test('kill-switch QA_MESH_SCHEDULER_DISABLED=true vence qualquer estado', () => {
    process.env.QA_MESH_SCHEDULER_DISABLED = 'true';
    process.env.QA_MESH_SCHEDULER_ENABLED = 'true';
    const status = startScheduler();
    expect(status).toMatchObject({ enabled: false, reason: 'QA_MESH_SCHEDULER_DISABLED' });
  });
});
