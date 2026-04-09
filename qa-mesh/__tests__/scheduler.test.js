'use strict';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(() => {
    throw new Error('missing');
  }),
  writeFileSync: jest.fn(),
}));

jest.mock('../meshRunner', () => ({
  loadRegistry: jest.fn(() => []),
  runMesh: jest.fn(),
}));

const fs = require('fs');
const meshRunner = require('../meshRunner');
const { selectScenariosForSchedule, runScheduledMesh } = require('../meshScheduler');

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
      executionKind: 'critical',
      autoReplayOnFailure: true,
      writeCanonicalOutputs: false,
      scenarioIds: ['smoke-core', 'technical-pbx'],
    }));
  });
});
