'use strict';

process.env.QA_MESH_DISABLE_SCHEDULER = '1';

let capturedRunner;
const mockRunMesh = jest.fn(async () => ({ summary: { goNoGo: 'GO' }, results: [] }));

jest.mock('../../../qa-mesh/meshRunner', () => ({
  loadRegistry: jest.fn(() => []),
  refreshRegistry: jest.fn(() => []),
  runMesh: (...args) => mockRunMesh(...args),
  loadHistory: jest.fn(() => []),
  normalizeExecutionRecord: jest.fn((execution) => execution),
}));

jest.mock('../../../qa-mesh/meshScheduler', () => ({
  buildScheduleStatus: jest.fn(() => ({})),
  runScheduledMesh: jest.fn(),
  startScheduler: jest.fn(),
}));

jest.mock('../../../qa-mesh/executionQueue', () => ({
  enqueueExecution: jest.fn((kind, payload, runner) => {
    capturedRunner = runner;
    return { executionId: 'exec-test', status: 'queued', kind, payload };
  }),
  getExecution: jest.fn(() => null),
  getAllExecutions: jest.fn(() => []),
  appendLog: jest.fn(),
  updateExecution: jest.fn(),
}));

jest.mock('../websocketService', () => ({ emitEvent: jest.fn() }));

describe('qaMeshService.queueMeshRun — propagação de executionOrigin', () => {
  let qaMeshService;

  beforeEach(() => {
    jest.resetModules();
    capturedRunner = undefined;
    mockRunMesh.mockClear();
    qaMeshService = require('../qaMeshService');
  });

  test('propaga executionOrigin informado (qa_waves_real) para o runMesh persistir no histórico', async () => {
    qaMeshService.queueMeshRun({ scenarioIds: ['cenario-x'], executionOrigin: 'qa_waves_real' });

    expect(capturedRunner).toBeInstanceOf(Function);
    await capturedRunner('exec-test-1');

    expect(mockRunMesh).toHaveBeenCalledWith(
      expect.objectContaining({ executionOrigin: 'qa_waves_real' }),
    );
  });

  test('sem executionOrigin explícito mantém manual_run (compatibilidade)', async () => {
    qaMeshService.queueMeshRun({ scenarioIds: ['cenario-x'] });

    await capturedRunner('exec-test-2');

    expect(mockRunMesh).toHaveBeenCalledWith(
      expect.objectContaining({ executionOrigin: 'manual_run' }),
    );
  });
});
