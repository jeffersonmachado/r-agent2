describe('generationOrchestrator - defensive coercions', () => {
  function mockCommonDeps({ planSubflowsImpl, generateFlowImpl }) {
    jest.doMock('../../api/utils/contractValidator', () => ({
      validateGenerationContract: jest.fn(() => ({ valid: true, errors: [] })),
    }));

    jest.doMock('../../api/services/aiFlowGenerator', () => ({
      generateFlowFromDescription: jest.fn(generateFlowImpl),
    }));

    jest.doMock('../../api/services/subflowPlannerService', () => ({
      planSubflows: jest.fn(planSubflowsImpl),
    }));

    jest.doMock('../../api/services/ragContextBuilder', () => ({
      buildDiverseRagContext: jest.fn(async () => ({ contextSources: [] })),
    }));

    jest.doMock('../../api/services/rpaTestDependencyAnalyzer', () => ({
      analyzeFlowDependencies: jest.fn(() => ({ seeds: [] })),
      resolveDependencies: jest.fn(async () => ({ resolved: [] })),
    }));

    jest.doMock('../../api/services/rpaTestGeneratorService', () => ({
      generateRpaTestFromFlow: jest.fn(async () => ({ id: 'rpa-1', steps: [], asserts: [] })),
    }));

    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
    }));

    jest.doMock('../../api/services/rpaService', () => ({
      executeRecording: jest.fn(async () => ({ success: true, executionId: 'exec-1' })),
      getExecutionStatus: jest.fn(() => ({ status: 'completed', progress: 100, logs: [] })),
      saveTemporaryRecording: jest.fn(),
      removeTemporaryRecording: jest.fn(),
    }));

    jest.doMock('../../lib/replaySystem', () => ({
      ReplaySystem: jest.fn().mockImplementation(() => ({
        start: jest.fn(),
        recordEvent: jest.fn(),
        recordAction: jest.fn(),
        recordError: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      })),
    }));

    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: jest.fn().mockImplementation(() => ({
        start: jest.fn(),
        recordAction: jest.fn(),
        recordGeneration: jest.fn(),
        recordCustom: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'recordings/mock.json'),
      })),
    }));
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('tolerates hostile subflow fields during main description assembly', async () => {
    const hostileId = { toString() { throw new Error('id explode'); } };
    const hostileName = { toString() { throw new Error('name explode'); } };

    mockCommonDeps({
      planSubflowsImpl: async () => ([{ name: 'Sub A', role: 'sales', description: 'desc sub' }]),
      generateFlowImpl: jest
        .fn()
        .mockResolvedValueOnce({
          flowDefinition: {
            id: hostileId,
            name: hostileName,
            nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }],
            metadata: {},
          },
        })
        .mockResolvedValueOnce({
          flowDefinition: {
            id: 'flow-main-1',
            name: 'Main',
            nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }],
          },
        }),
    });

    const { orchestrateGeneration } = require('../../api/services/generationOrchestrator');

    const res = await orchestrateGeneration(
      {
        name: 'Fluxo Teste',
        description: 'descricao principal',
        useRag: false,
        useWebScraping: false,
        generateRpaTest: false,
      },
      { tenantId: 'tenant-1', dryRun: false }
    );

    expect(res.success).toBe(true);
    expect(res.flowDefinition.id).toBe('flow-main-1');
  });

  it('tolerates hostile thrown value from subflow planner', async () => {
    const hostileThrown = { toString() { throw new Error('planner explode'); } };

    mockCommonDeps({
      planSubflowsImpl: async () => {
        throw hostileThrown;
      },
      generateFlowImpl: async () => ({
        flowDefinition: {
          id: 'flow-main-2',
          name: 'Main 2',
          nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }],
        },
      }),
    });

    const { orchestrateGeneration } = require('../../api/services/generationOrchestrator');

    const res = await orchestrateGeneration(
      {
        name: 'Fluxo Planner Error',
        description: 'descricao principal',
        useRag: false,
        useWebScraping: false,
        generateRpaTest: false,
      },
      { tenantId: 'tenant-1', dryRun: false }
    );

    expect(res.success).toBe(true);
    expect(res.flowDefinition.id).toBe('flow-main-2');
  });
});
