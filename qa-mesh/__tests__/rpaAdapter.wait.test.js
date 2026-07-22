'use strict';

const { EventEmitter } = require('events');

const mockEvents = new EventEmitter();
let mockStatus = null;

jest.mock('../../api/services/rpaService', () => ({
  executeRecording: jest.fn(),
  getExecutionStatus: jest.fn(),
  rpaExecutionEvents: mockEvents,
}));

const { executeScenario } = require('../adapters/rpaAdapter');
const { executeRecording, getExecutionStatus } = require('../../api/services/rpaService');

describe('rpaAdapter waitForExecution (orientado a evento)', () => {
  beforeEach(() => {
    // resetMocks:true no jest.config — redefinir implementações a cada teste
    executeRecording.mockImplementation(async () => ({ executionId: 'rpa-test-1' }));
    getExecutionStatus.mockImplementation(() => mockStatus);
    mockStatus = null;
    mockEvents.removeAllListeners('updated');
    process.env.QA_MESH_RPA_MAX_ATTEMPTS = '1';
    process.env.QA_MESH_RPA_MAX_WAIT_MS = '2000';
  });

  afterEach(() => {
    delete process.env.QA_MESH_RPA_MAX_ATTEMPTS;
    delete process.env.QA_MESH_RPA_MAX_WAIT_MS;
  });

  it('resolve sucesso quando a execução já está terminal antes da assinatura', async () => {
    mockStatus = {
      status: 'completed',
      progress: 100,
      totalSteps: 2,
      results: { success: true, steps: [{ success: true }], errors: [] },
      logs: [],
    };

    const result = await executeScenario({ id: 'sc-1', rpaRecordingId: 'rec-1', recordVideo: false });
    expect(result.success).toBe(true);
    expect(result.metrics.status).toBe('completed');
    expect(result.rawStatus.status).toBe('completed');
  });

  it('resolve via evento quando a execução chega a status terminal', async () => {
    mockStatus = { status: 'running', progress: 10, currentStep: 'Ação 1/2', totalSteps: 2, logs: [] };

    const scenarioPromise = executeScenario({ id: 'sc-2', rpaRecordingId: 'rec-1', recordVideo: false });
    setTimeout(() => {
      mockStatus = {
        status: 'completed',
        progress: 100,
        totalSteps: 2,
        results: { success: true, steps: [], errors: [] },
        logs: [{ message: 'ok' }],
      };
      mockEvents.emit('updated', { id: 'rpa-test-1', status: 'completed' });
    }, 20);

    const result = await scenarioPromise;
    expect(result.success).toBe(true);
    expect(result.logs).toEqual([{ message: 'ok' }]);
  });

  it('ignora eventos de outras execuções', async () => {
    mockStatus = { status: 'running', progress: 10, totalSteps: 2, logs: [] };

    const scenarioPromise = executeScenario({ id: 'sc-3', rpaRecordingId: 'rec-1', recordVideo: false });
    setTimeout(() => mockEvents.emit('updated', { id: 'outra-exec', status: 'completed' }), 10);
    setTimeout(() => {
      mockStatus = { status: 'failed', progress: 100, results: { success: false, errors: [{ error: 'boom' }] }, logs: [] };
      mockEvents.emit('updated', { id: 'rpa-test-1', status: 'failed' });
    }, 40);

    const result = await scenarioPromise;
    expect(result.success).toBe(false);
    expect(result.metrics.status).toBe('failed');
  });

  it('notifica progresso a cada evento não terminal', async () => {
    mockStatus = { status: 'running', progress: 10, currentStep: 'Ação 1/3', totalSteps: 3, logs: [] };
    const progressUpdates = [];

    const scenarioPromise = executeScenario(
      { id: 'sc-4', rpaRecordingId: 'rec-1', recordVideo: false },
      { onStepProgress: (p) => progressUpdates.push(p) }
    );

    setTimeout(() => {
      mockStatus = { ...mockStatus, progress: 50 };
      mockEvents.emit('updated', { id: 'rpa-test-1', status: 'running' });
    }, 10);
    setTimeout(() => {
      mockStatus = { status: 'completed', progress: 100, totalSteps: 3, results: { success: true, steps: [] }, logs: [] };
      mockEvents.emit('updated', { id: 'rpa-test-1', status: 'completed' });
    }, 30);

    const result = await scenarioPromise;
    expect(result.success).toBe(true);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[0]).toHaveProperty('progress');
    expect(progressUpdates[0]).toHaveProperty('totalSteps');
  });

  it('retorna timeout quando o deadline estoura sem evento terminal', async () => {
    process.env.QA_MESH_RPA_MAX_WAIT_MS = '80';
    mockStatus = { status: 'running', progress: 10, totalSteps: 2, logs: [] };

    const result = await executeScenario({ id: 'sc-5', rpaRecordingId: 'rec-1', recordVideo: false });
    expect(result.success).toBe(false);
    expect(result.metrics.status).toBe('timeout');
    expect(result.errors[0].error).toMatch(/Tempo limite excedido/);
  });

  it('retorna missing quando a execução não existe', async () => {
    mockStatus = null;

    const result = await executeScenario({ id: 'sc-6', rpaRecordingId: 'rec-1', recordVideo: false });
    expect(result.success).toBe(false);
    expect(result.metrics.status).toBe('missing');
    expect(result.errors).toContain('Execução não encontrada');
  });
});
