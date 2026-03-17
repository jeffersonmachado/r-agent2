describe('pipelineOrchestrator - defensive coercions', () => {
  function setupMocks({ emitImpl }) {
    jest.doMock('../../api/services/pipelineExecutionContext', () => ({
      updateStage: jest.fn(),
      updateStatus: jest.fn((execution, status) => {
        execution.status = status;
      }),
      isStageCompleted: jest.fn(() => true),
      getNextPendingStage: jest.fn(() => 'flowGenerated'),
      toProgressFormat: jest.fn((execution) => ({ executionId: execution.executionId, status: execution.status })),
      tryApprove: jest.fn(() => false),
    }));

    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent: jest.fn(emitImpl),
    }));

    jest.doMock('../../api/services/executionPersistence', () => ({
      hasFinalDecision: jest.fn(async () => false),
      reuseDecision: jest.fn(async () => false),
      persistExecution: jest.fn(async () => ({})),
    }));
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('advancePipeline does not crash when websocket emit throws hostile value', async () => {
    const hostileThrown = {
      get message() {
        return undefined;
      },
      toString() {
        throw new Error('emit stringify exploded');
      },
    };

    setupMocks({
      emitImpl: () => {
        throw hostileThrown;
      },
    });

    const { advancePipeline } = require('../../api/services/pipelineOrchestrator');

    const execution = {
      executionId: 'exec-coercion-1',
      status: 'idle',
      stages: { flowGenerated: false },
      options: { tenantId: 'tenant-1' },
      payload: { name: 'Fluxo X' },
      _replay: {
        recordEvent: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      },
    };

    await expect(advancePipeline(execution)).resolves.toEqual({ shouldContinue: true });
  });

  it('advancePipeline keeps nominal behavior when websocket emit throws normal Error', async () => {
    setupMocks({
      emitImpl: () => {
        throw new Error('ws offline');
      },
    });

    const { advancePipeline } = require('../../api/services/pipelineOrchestrator');

    const execution = {
      executionId: 'exec-coercion-2',
      status: 'idle',
      stages: { flowGenerated: false },
      options: { tenantId: 'tenant-1' },
      payload: { name: 'Fluxo Y' },
      _replay: {
        recordEvent: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      },
    };

    const result = await advancePipeline(execution);
    expect(result).toEqual({ shouldContinue: true });
    expect(execution.status).toBe('running');
  });
});
