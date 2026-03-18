'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('flowGeneratorService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockDeps({ generateImpl, scrapeImpl } = {}) {
    jest.doMock('../../api/services/aiWrappersAdapter', () => ({
      generateChatbotViaCore: jest.fn(generateImpl || (async () => ({
        success: true,
        flowDefinition: {
          name: 'Fluxo Teste',
          nodes: [
            { id: 'start', type: 'start', next: 'end' },
            { id: 'end', type: 'end' },
          ],
        },
        validation: { valid: true, errors: [], warnings: [] },
        envelope: null,
        promptVersion: 'test',
      }))),
    }));

    jest.doMock('../../api/services/ragService', () => ({}));

    jest.doMock('../../api/services/webScrapingService', () => ({
      scrapeUrl: jest.fn(scrapeImpl || (async () => ({
        success: true,
        title: 'Source',
        content: 'Conteudo de teste',
        contentLength: 17,
      }))),
    }));

    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: class RecordingSystemMock {
        start() {}
        recordAction() {}
        recordCustom() {}
        stop() {}
        save() {}
      },
    }));

    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
    }));
  }

  test('generateFlowFromKeywords: tolera descrição hostil (toString getter)', () => {
    mockDeps();
    const { generateFlowFromKeywords } = require('../../api/services/flowGeneratorService');

    const hostileDescription = {};
    Object.defineProperty(hostileDescription, 'toString', {
      get() {
        throw new Error('getter hostil em description');
      },
      enumerable: true,
    });

    const flow = generateFlowFromKeywords(hostileDescription, {
      tenantId: 't1',
      flowId: 'flow-test',
      flowName: 'Fluxo Hostil',
    });

    expect(flow).toBeDefined();
    expect(flow.metadata).toBeDefined();
    expect(typeof flow.metadata.description).toBe('string');
  });

  test('generateFlowFromDescription: não lança com descrição hostil', async () => {
    mockDeps();
    const { generateFlowFromDescription } = require('../../api/services/flowGeneratorService');

    const hostileDescription = {};
    Object.defineProperty(hostileDescription, 'toString', {
      get() {
        throw new Error('getter hostil em description');
      },
      enumerable: true,
    });

    await expect(
      generateFlowFromDescription(hostileDescription, {
        tenantId: 't1',
        useRag: false,
        useWebScraping: false,
        maxFixAttempts: 1,
      })
    ).resolves.toBeDefined();
  });

  test('generateFlowFromDescription: ignora scrapeError.message hostil sem quebrar', async () => {
    mockDeps({
      scrapeImpl: async () => {
        const hostileErr = {};
        Object.defineProperty(hostileErr, 'message', {
          get() {
            throw new Error('getter hostil em scrapeError.message');
          },
          enumerable: true,
        });
        throw hostileErr;
      },
    });

    const { generateFlowFromDescription } = require('../../api/services/flowGeneratorService');

    await expect(
      generateFlowFromDescription('fluxo simples', {
        tenantId: 't1',
        useRag: false,
        useWebScraping: true,
        scrapingTargets: ['https://example.com'],
        maxFixAttempts: 1,
      })
    ).resolves.toBeDefined();
  });
});
