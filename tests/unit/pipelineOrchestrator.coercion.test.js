describe('pipelineOrchestrator - defensive coercions', () => {
  function setupMocks({
    emitImpl,
    isStageCompletedImpl = () => true,
    nextStage = 'flowGenerated',
    orchestrateGenerationImpl = async () => ({ success: true, flowDefinition: { id: 'flow-default' } }),
    getSequelizeImpl,
    flowFactoryImpl,
  }) {
    jest.doMock('../../api/services/pipelineExecutionContext', () => ({
      updateStage: jest.fn(),
      updateStatus: jest.fn((execution, status) => {
        execution.status = status;
      }),
      isStageCompleted: jest.fn(isStageCompletedImpl),
      getNextPendingStage: jest.fn(() => nextStage),
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

    jest.doMock('../../api/services/generationOrchestrator', () => ({
      orchestrateGeneration: jest.fn(orchestrateGenerationImpl),
      saveFlowToFile: jest.fn(async () => ({})),
      removeFlowFromFile: jest.fn(async () => ({})),
    }));

    if (typeof getSequelizeImpl === 'function') {
      jest.doMock('../../api/db/sequelize', () => ({
        getSequelize: jest.fn(getSequelizeImpl),
      }));
    }

    if (typeof flowFactoryImpl === 'function') {
      jest.doMock('../../api/db/models', () => ({
        Flow: jest.fn(flowFactoryImpl),
      }));
    }
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

  it('advancePipeline does not crash when stage throws hostile value without message', async () => {
    const hostileError = {};
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('hostile message getter');
      },
    });
    hostileError.toString = () => {
      throw new Error('hostile toString');
    };

    setupMocks({
      emitImpl: jest.fn(),
      isStageCompletedImpl: () => false,
      nextStage: 'aiExecuted',
      orchestrateGenerationImpl: async () => {
        throw hostileError;
      },
    });

    const { advancePipeline } = require('../../api/services/pipelineOrchestrator');

    const execution = {
      executionId: 'exec-coercion-3',
      status: 'idle',
      stages: { aiExecuted: false, flowGenerated: false },
      options: { tenantId: 'tenant-1' },
      payload: { name: 'Fluxo Z', useRag: false, executionMode: 'normal' },
      _replay: {
        recordEvent: jest.fn(),
        recordAction: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      },
    };

    const result = await advancePipeline(execution);
    expect(result).toEqual({ shouldContinue: false, error: '' });
    expect(execution.status).toBe('failed');
  });

  it('advancePipeline handles hostile DB errors while persisting flow for RPA', async () => {
    const hostileDbError = {};
    Object.defineProperty(hostileDbError, 'message', {
      get() {
        throw new Error('db message getter exploded');
      },
    });
    hostileDbError.toString = () => {
      throw new Error('db toString exploded');
    };

    setupMocks({
      emitImpl: jest.fn(),
      isStageCompletedImpl: () => false,
      nextStage: 'aiExecuted',
      orchestrateGenerationImpl: async () => ({
        success: true,
        flowDefinition: { id: 'flow-hostile-db', name: 'Flow Hostile DB' },
      }),
      getSequelizeImpl: () => ({}),
      flowFactoryImpl: () => ({
        findByPk: jest.fn(async () => {
          throw hostileDbError;
        }),
        create: jest.fn(async () => ({})),
      }),
    });

    const { advancePipeline } = require('../../api/services/pipelineOrchestrator');

    const execution = {
      executionId: 'exec-coercion-4',
      status: 'idle',
      stages: { aiExecuted: false, flowGenerated: false },
      options: { tenantId: 'tenant-1' },
      payload: {
        name: 'Fluxo Persist Hostile',
        useRag: false,
        executionMode: 'normal',
        bootstrap: true,
      },
      _replay: {
        recordEvent: jest.fn(),
        recordAction: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      },
    };

    const result = await advancePipeline(execution);
    expect(result.shouldContinue).toBe(false);
    expect(result.error).toContain('Falha ao persistir flow para execução RPA');
    expect(execution.status).toBe('failed');
  });
});
