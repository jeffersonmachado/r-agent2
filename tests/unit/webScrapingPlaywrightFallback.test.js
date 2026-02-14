/**
 * Testes unitários para fallback Playwright no webScrapingService.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../infra/rate-limit/scraping', () => ({
  enforceScrapingRateLimit: jest.fn(async () => {}),
}));

jest.mock('../../api/services/ragDocumentsService', () => ({
  createDocument: jest.fn(async () => ({
    success: true,
    document: { indexed: true, chunksCount: 1 },
  })),
}));

jest.mock('../../lib/replaySystem', () => ({
  ReplaySystem: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    recordEvent: jest.fn(),
    recordAction: jest.fn(),
    recordError: jest.fn(),
    stop: jest.fn(),
    save: jest.fn(),
  })),
}));

jest.mock('../../lib/recordingSystem', () => ({
  RecordingSystem: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    recordAction: jest.fn(),
    recordCustom: jest.fn(),
    stop: jest.fn(),
    save: jest.fn(),
  })),
}));

describe('webScrapingService (Playwright fallback)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.USE_PLAYWRIGHT = 'true';
  });

  afterEach(() => {
    delete process.env.USE_PLAYWRIGHT;
    // @ts-ignore
    delete global.fetch;
  });

  test('html curto ativa fallback Playwright', async () => {
    // Mock fetch com conteúdo muito curto
    // @ts-ignore
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html><head><title>Studio Oly</title><meta name="description" content="desc"></head><body><h1>Oi</h1></body></html>',
    }));

    // Mock Playwright com conteúdo longo
    const launch = jest.fn(async () => ({
      newContext: async () => ({
        newPage: async () => ({
          setDefaultTimeout: jest.fn(),
          setDefaultNavigationTimeout: jest.fn(),
          goto: jest.fn(async () => {}),
          waitForTimeout: jest.fn(async () => {}),
          evaluate: jest.fn(async () => ({
            title: 'Studio Oly',
            metaDescription: 'desc',
            headings: ['Studio Oly'],
            extractedText: 'A'.repeat(300),
          })),
          close: jest.fn(async () => {}),
        }),
        close: jest.fn(async () => {}),
      }),
      close: jest.fn(async () => {}),
    }));

    jest.doMock('playwright', () => ({ chromium: { launch } }));

    // eslint-disable-next-line global-require
    const { scrapeUrl } = require('../../api/services/webScrapingService');
    const result = await scrapeUrl('https://studiooly.com.br/', { tenantId: 't1', autoIndex: true });

    expect(result.success).toBe(true);
    expect(result.extractedText.length).toBeGreaterThanOrEqual(200);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.some(w => w.code === 'PLAYWRIGHT_FALLBACK_USED')).toBe(true);
    expect(launch).toHaveBeenCalled();
  });

  test('Playwright falha e ainda indexa seed mínimo', async () => {
    // fetch falha
    // @ts-ignore
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });

    // Playwright também falha
    jest.doMock('playwright', () => ({
      chromium: { launch: jest.fn(async () => { throw new Error('pw down'); }) },
    }));

    // eslint-disable-next-line global-require
    const ragDocumentsService = require('../../api/services/ragDocumentsService');
    // eslint-disable-next-line global-require
    const { scrapeUrl } = require('../../api/services/webScrapingService');

    const result = await scrapeUrl('https://studiooly.com.br/', { tenantId: 't1', autoIndex: true });

    expect(result.success).toBe(true);
    expect(result.extractedText).toContain('Sem texto extraído');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.some(w => w.code === 'SCRAPE_FAILED')).toBe(true);
    expect(result.warnings.some(w => w.code === 'PLAYWRIGHT_FAILED')).toBe(true);
    expect(ragDocumentsService.createDocument).toHaveBeenCalled();
  });
});

