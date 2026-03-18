'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('aiWrappersAdapter coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockBaseDeps({
    generateAiResponseImpl = async () => ({ text: '{"ok":true}' }),
    generateChatbotFlowCoreImpl = async () => ({ flowDefinition: { nodes: [] } }),
    readFileSyncImpl = () => '{}',
  } = {}) {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn(readFileSyncImpl),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(generateAiResponseImpl),
    }));

    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ ok: true })),
    }));

    jest.doMock('../../engine/ai/validateGeneratedPlan', () => ({
      validateGeneratedPlan: jest.fn(() => ({ ok: true })),
    }));

    jest.doMock('../../engine/ai/aiEnvelope', () => ({
      validateByContract: jest.fn(() => ({ ok: true })),
      buildAiEnvelope: jest.fn((x) => x),
      validateAiEnvelopeOrThrow: jest.fn(() => true),
    }));

    jest.doMock('../../engine/ai/flowGenerator', () => ({
      generateChatbotFlowCore: jest.fn(generateChatbotFlowCoreImpl),
      generateRpaTestCore: jest.fn(async () => ({ success: true })),
    }));

    jest.doMock('../../api/services/ragContextBuilder', () => ({
      buildDiverseRagContext: jest.fn(async () => ({ contextSources: [] })),
    }));

    jest.doMock('../../api/utils/flowPreValidator', () => ({
      validateFlowDraft: jest.fn(() => true),
    }));
  }

  test('buildChatbotFinalPrompt tolera ragContext hostil sem lançar', async () => {
    mockBaseDeps({ readFileSyncImpl: () => '{}' });

    const hostileChunk = { toString() { throw new Error('boom-chunk'); } };
    const hostileSource = { toString() { throw new Error('boom-source'); } };

    const { buildChatbotFinalPrompt } = require('../../api/services/aiWrappersAdapter');
    const out = await buildChatbotFinalPrompt('descricao de teste', {
      tenantId: 'tenant-1',
      ragContext: {
        enabled: true,
        executionId: 'exec-1',
        chunks: [{ content: hostileChunk }],
        sources: [hostileSource],
      },
    });

    expect(out).toEqual(expect.objectContaining({
      finalPrompt: expect.any(String),
      objective: 'descricao de teste',
      ragMeta: expect.objectContaining({
        ragUsed: true,
      }),
    }));
    expect(out.finalPrompt).toContain('## Descrição do Usuário');
    expect(Array.isArray(out.ragMeta.ragSources)).toBe(true);
  });

  test('generateChatbotViaCore não explode ao ler err.message getter hostil', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-message-getter'); },
      enumerable: true,
    });

    mockBaseDeps({
      generateAiResponseImpl: async () => { throw hostileErr; },
      generateChatbotFlowCoreImpl: async ({ deps }) => {
        await deps.callModel('prompt qualquer');
        return { flowDefinition: { nodes: [{ id: 'n1', type: 'start' }] } };
      },
      readFileSyncImpl: () => '{}',
    });

    const { generateChatbotViaCore } = require('../../api/services/aiWrappersAdapter');

    await expect(
      generateChatbotViaCore('gerar fluxo', { tenantId: 'tenant-1' }, {})
    ).rejects.toBe(hostileErr);
  });
});
