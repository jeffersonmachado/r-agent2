jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('api/services/flowGeneratorService - failure metadata on fallback', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockDeps({ generateChatbotViaCoreImpl }) {
    jest.doMock('../../api/services/aiWrappersAdapter', () => ({
      generateChatbotViaCore: jest.fn(generateChatbotViaCoreImpl),
    }));

    // Evita side-effects em imports (RAG/scraping/recording); estes caminhos não são usados nesses testes.
    jest.doMock('../../api/services/ragService', () => ({}));
    jest.doMock('../../api/services/webScrapingService', () => ({}));
    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: class RecordingSystemMock {
        start() {}
        recordAction() {}
        recordCustom() {}
        stop() {}
        save() {}
      },
    }));
  }

  test('inclui failureSource/provider + failureMessage quando provider falha (ex.: 429)', async () => {
    mockDeps({
      generateChatbotViaCoreImpl: async () => {
        const err = new Error('429 You exceeded your current quota.');
        err.status = 429;
        err.code = 'insufficient_quota';
        throw err;
      },
    });

    const { generateFlowFromDescription } = require('../../api/services/flowGeneratorService');

    const flow = await generateFlowFromDescription('completo', {
      tenantId: 't1',
      useRag: false,
      useWebScraping: false,
      maxFixAttempts: 1,
    });

    expect(flow?.metadata?.aiGeneration?.usedFallback).toBe(true);
    expect(flow?.metadata?.aiGeneration?.failureSource).toBe('provider');
    expect(String(flow?.metadata?.aiGeneration?.failureMessage || '')).toContain('429');
  });

  test('inclui failureSource/wrapper + failureMessage quando wrapper rejeita', async () => {
    mockDeps({
      generateChatbotViaCoreImpl: async () => ({
        success: false,
        error: { type: 'VALIDATION_FAILED', message: 'Saída fora do contrato esperado' },
        validation: null,
        envelope: null,
        flowDefinition: null,
      }),
    });

    const { generateFlowFromDescription } = require('../../api/services/flowGeneratorService');

    const flow = await generateFlowFromDescription('completo', {
      tenantId: 't1',
      useRag: false,
      useWebScraping: false,
      maxFixAttempts: 1,
    });

    expect(flow?.metadata?.aiGeneration?.usedFallback).toBe(true);
    expect(flow?.metadata?.aiGeneration?.failureSource).toBe('wrapper');
    expect(String(flow?.metadata?.aiGeneration?.failureMessage || '')).toContain('contrato');
  });

  test('não lança quando err.message é um getter hostil no pipeline de geração', async () => {
    mockDeps({
      generateChatbotViaCoreImpl: async () => {
        const hostile = {};
        Object.defineProperty(hostile, 'message', {
          get() { throw new Error('getter hostil em flowGenerator'); },
          enumerable: true,
        });
        throw hostile;
      },
    });

    const { generateFlowFromDescription } = require('../../api/services/flowGeneratorService');

    let result;
    await expect(
      generateFlowFromDescription('qualquer descrição', {
        tenantId: 't1',
        useRag: false,
        useWebScraping: false,
        maxFixAttempts: 1,
      }).then((r) => { result = r; })
    ).resolves.not.toThrow();

    // Deve ter retornado um flow de fallback (não undefined/null)
    expect(result).toBeDefined();
  });
});

