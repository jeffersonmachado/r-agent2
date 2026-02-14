/**
 * Testes unitários para OCR (tesseract.js).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('fileExtractionService (OCR)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('OCR retorna texto contendo "PIX"', async () => {
    const worker = {
      loadLanguage: jest.fn(async () => {}),
      initialize: jest.fn(async () => {}),
      recognize: jest.fn(async () => ({ data: { text: 'Pagamento via PIX disponível' } })),
      terminate: jest.fn(async () => {}),
    };

    jest.doMock('tesseract.js', () => ({
      createWorker: jest.fn(async () => worker),
    }));

    // eslint-disable-next-line global-require
    const { extractTextFromFile } = require('../../api/services/fileExtractionService');
    const res = await extractTextFromFile(
      { buffer: Buffer.from('fake-image'), mimeType: 'image/png', filename: 'comprovante.png' },
      { useOcr: true, timeoutMs: 15000 },
    );

    expect(res.extractedText).toContain('PIX');
    expect(worker.recognize).toHaveBeenCalled();
  });
});

