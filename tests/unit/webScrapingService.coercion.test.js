'use strict';

const fs = require('fs');
const path = require('path');

describe('webScrapingService coercion hardening', () => {
  const oldReplay = process.env.ENABLE_SCRAPING_REPLAY;
  const oldRecording = process.env.ENABLE_SCRAPING_RECORDING;
  const oldDegraded = process.env.SCRAPING_ALLOW_DEGRADED;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.ENABLE_SCRAPING_REPLAY = 'false';
    process.env.ENABLE_SCRAPING_RECORDING = 'false';
    // Testes de coerção não testam a ausência de cheerio; permitem modo
    // degradado para que o serviço passe do guard e chegue na lógica testada.
    process.env.SCRAPING_ALLOW_DEGRADED = 'true';

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><body><main>Conteudo simples para teste de scraping.</main></body></html>',
    }));

    jest.doMock('../../api/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.doMock('../../api/services/ragDocumentsService', () => ({
      createDocument: jest.fn(async () => ({ success: true, document: { indexed: true, chunksCount: 1 } })),
    }));

    jest.doMock('../../infra/rate-limit/scraping', () => ({
      enforceScrapingRateLimit: jest.fn(async () => ({})),
    }));

    jest.doMock('../../lib/replaySystem', () => ({
      ReplaySystem: class ReplaySystemMock {
        start() {}
        recordEvent() {}
        recordError() {}
        recordAction() {}
        stop() {}
        save() {}
      },
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
  });

  afterAll(() => {
    process.env.ENABLE_SCRAPING_REPLAY = oldReplay;
    process.env.ENABLE_SCRAPING_RECORDING = oldRecording;
    if (oldDegraded === undefined) {
      delete process.env.SCRAPING_ALLOW_DEGRADED;
    } else {
      process.env.SCRAPING_ALLOW_DEGRADED = oldDegraded;
    }
  });

  test('nao quebra quando createDocument falha com indexError.message hostil', async () => {
    const hostileError = {};
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('hostile indexError.message getter');
      },
      enumerable: true,
    });

    const ragDocs = require('../../api/services/ragDocumentsService');
    ragDocs.createDocument.mockRejectedValue(hostileError);

    const svc = require('../../api/services/webScrapingService');

    const out = await svc.scrapeUrl('https://example.com', {
      tenantId: 'tenant-1',
      autoIndex: true,
      timeout: 1000,
    });

    // indexacao pode falhar, mas scraping deve concluir sem crash
    expect(out.success).toBe(true);
    expect(out.url).toBe('https://example.com');
  });

  test('nao quebra no catch principal quando rate limit lanca erro hostil', async () => {
    const hostileError = {};
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('hostile rateLimit.message getter');
      },
      enumerable: true,
    });
    hostileError.toString = () => {
      throw new Error('hostile toString');
    };

    const { enforceScrapingRateLimit } = require('../../infra/rate-limit/scraping');
    enforceScrapingRateLimit.mockRejectedValue(hostileError);

    const svc = require('../../api/services/webScrapingService');

    await expect(
      svc.scrapeUrl('https://example.com', {
        tenantId: 'tenant-1',
        autoIndex: false,
        timeout: 1000,
      })
    ).rejects.toBeDefined();
  });

  test('nao quebra quando erro hostil tem message e toString que lancam', async () => {
    const hostileError = {
      get message() {
        throw new Error('hostile message getter');
      },
      toString() {
        throw new Error('hostile toString');
      },
    };

    const { enforceScrapingRateLimit } = require('../../infra/rate-limit/scraping');
    enforceScrapingRateLimit.mockRejectedValue(hostileError);

    const svc = require('../../api/services/webScrapingService');

    await expect(
      svc.scrapeUrl('https://example.com', {
        tenantId: 'tenant-1',
        autoIndex: false,
        timeout: 1000,
      })
    ).rejects.toBeDefined();
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/webScrapingService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
