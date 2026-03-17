describe('initialGraphService - defensive coercions', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('generateInitialGraph handles hostile tenantIdForAI without propagating toString error', async () => {
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(),
    }));

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(),
      updateTenant: jest.fn(),
    }));

    jest.doMock('../../api/services/faqGeneratorService', () => ({
      generateFaq: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const { generateInitialGraph } = require('../../api/services/initialGraphService');

    const hostileTenantId = {
      toString() {
        throw new Error('tenantId boom');
      },
    };

    await expect(
      generateInitialGraph({
        tenantIdForAI: hostileTenantId,
        tenantIdTarget: 'tenant-target',
        dryRun: true,
      })
    ).rejects.toThrow('tenantIdForAI é obrigatório');
  });

  test('generateInitialGraph completes with hostile FAQ/context values when AI returns valid JSON', async () => {
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({
        text: JSON.stringify([
          {
            label: 'Geral',
            intents: [
              {
                intentId: 'intent_1',
                question: 'Como funciona?',
                examples: ['me explica'],
                answer: 'Funciona assim.',
              },
            ],
          },
        ]),
      })),
    }));

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 'tenant-target', settings: {} })),
      updateTenant: jest.fn(async () => ({ success: true })),
    }));

    const hostileQuestion = {
      toString() {
        throw new Error('question boom');
      },
    };
    const hostileContext = {
      toString() {
        throw new Error('context boom');
      },
    };

    jest.doMock('../../api/services/faqGeneratorService', () => ({
      generateFaq: jest.fn(async () => ({
        faq: [{ category: 'Atendimento', questions: [hostileQuestion, 'horário de atendimento'] }],
        coverage: 0.72,
        exclusions: [],
      })),
      _internal: {
        resolveContextSources: jest.fn(async () => ({
          contextSources: [{ text: hostileContext }, { excerpt: 'conteudo útil' }],
        })),
      },
    }));

    // eslint-disable-next-line global-require
    const { generateInitialGraph } = require('../../api/services/initialGraphService');

    const result = await generateInitialGraph({
      tenantIdForAI: 'tenant-ai',
      tenantIdTarget: 'tenant-target',
      dryRun: true,
      name: 'Fluxo Inicial',
      description: 'Teste de robustez',
    });

    expect(result).toBeTruthy();
    expect(result.persisted).toBe(false);
    expect(Array.isArray(result.categories)).toBe(true);
    expect(result.categories.length).toBeGreaterThan(0);
    expect(result.reteJson).toBeTruthy();
  });
});
