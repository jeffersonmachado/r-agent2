'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('semanticContextService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('extractSemanticContext rejects hostile tenantId coercion with required error', async () => {
    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources: jest.fn(async () => ({ used: 'inline', contextSources: [] })),
    }));
    jest.doMock('../../api/services/exclusions.service', () => ({
      sanitizeContext: jest.fn((x) => String(x || '')),
      getFinalExclusions: jest.fn(async () => ({ finalExclusions: [] })),
      loadTenantExclusions: jest.fn(async () => ([])),
      augmentExclusions: jest.fn(() => ([])),
    }));
    jest.doMock('../../api/services/questionGenerationRules.service', () => ({
      _internal: { detectModalitiesFromContext: jest.fn(() => ([])) },
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const { extractSemanticContext } = require('../../api/services/semanticContextService');

    await expect(extractSemanticContext({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      dryRun: true,
      useLlm: false,
    })).rejects.toThrow('tenantId é obrigatório');
  });

  test('extractSemanticContext tolerates hostile chunk text coercion', async () => {
    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources: jest.fn(async () => ({
        used: 'inline',
        contextSources: [
          { text: { toString: () => { throw new Error('boom-text'); } } },
          { text: 'Contato: contato@empresa.com' },
        ],
      })),
    }));
    jest.doMock('../../api/services/exclusions.service', () => ({
      sanitizeContext: jest.fn((x) => String(x || '')),
      getFinalExclusions: jest.fn(async () => ({ finalExclusions: [] })),
      loadTenantExclusions: jest.fn(async () => ([])),
      augmentExclusions: jest.fn(() => ([])),
    }));
    jest.doMock('../../api/services/questionGenerationRules.service', () => ({
      _internal: { detectModalitiesFromContext: jest.fn(() => ([])) },
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const { extractSemanticContext } = require('../../api/services/semanticContextService');

    const out = await extractSemanticContext({
      tenantId: 'tenant-1',
      dryRun: true,
      useLlm: false,
    });

    expect(out).toEqual(expect.objectContaining({
      cleanText: expect.any(String),
      contacts: expect.arrayContaining(['contato@empresa.com']),
    }));
  });

  test('detectBusinessType does not throw with hostile cleanText coercion', () => {
    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources: jest.fn(async () => ({ used: 'inline', contextSources: [] })),
    }));
    jest.doMock('../../api/services/exclusions.service', () => ({
      sanitizeContext: jest.fn((x) => String(x || '')),
      getFinalExclusions: jest.fn(async () => ({ finalExclusions: [] })),
      loadTenantExclusions: jest.fn(async () => ([])),
      augmentExclusions: jest.fn(() => ([])),
    }));
    jest.doMock('../../api/services/questionGenerationRules.service', () => ({
      _internal: { detectModalitiesFromContext: jest.fn(() => ([])) },
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const { detectBusinessType } = require('../../api/services/semanticContextService');

    const out = detectBusinessType({
      cleanText: { toString: () => { throw new Error('boom-clean'); } },
      schedules: [],
      locations: [],
    });

    expect(out).toBe('physical');
  });
});
