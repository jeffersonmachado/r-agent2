'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('fileExtractionService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('cleanupOcrText não quebra com entrada hostil', () => {
    const { cleanupOcrText } = require('../../api/services/fileExtractionService');
    const hostile = { toString() { throw new Error('boom-cleanup'); } };

    expect(() => cleanupOcrText(hostile)).not.toThrow();
    expect(cleanupOcrText(hostile)).toBe('');
  });

  test('extractPdfText tolera err.message getter hostil', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-pdf-message'); },
      enumerable: true,
    });

    jest.doMock('pdf-parse', () => jest.fn(async () => { throw hostileErr; }));

    const { extractPdfText } = require('../../api/services/fileExtractionService');
    const out = await extractPdfText(Buffer.from('%PDF-1.7'));

    expect(out).toEqual(expect.objectContaining({
      text: '',
      warnings: expect.any(Array),
    }));
    expect(out.warnings.some((w) => w.code === 'PDF_PARSE_FAILED')).toBe(true);
  });

  test('extractImageTextOcr tolera texto OCR hostil e parâmetros com erro hostil', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-ocr-message'); },
      enumerable: true,
    });

    const hostileText = { toString() { throw new Error('boom-ocr-text'); } };

    jest.doMock('tesseract.js', () => ({
      createWorker: jest.fn(async () => ({
        loadLanguage: jest.fn(async () => {}),
        initialize: jest.fn(async () => {}),
        setParameters: jest.fn(async () => { throw hostileErr; }),
        recognize: jest.fn(async () => ({
          data: {
            text: hostileText,
            confidence: 80,
          },
        })),
        terminate: jest.fn(async () => {}),
      })),
    }));

    const { extractImageTextOcr } = require('../../api/services/fileExtractionService');
    const out = await extractImageTextOcr(Buffer.from([1, 2, 3]));

    expect(out).toEqual(expect.objectContaining({
      text: expect.any(String),
      warnings: expect.any(Array),
    }));
    expect(out.warnings.some((w) => w.code === 'OCR_PARAMS_UNSUPPORTED')).toBe(true);
  });
});
