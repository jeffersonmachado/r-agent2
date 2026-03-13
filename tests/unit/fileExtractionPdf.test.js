/**
 * Testes unitários para extração de PDF (pdf-parse).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('fileExtractionService (PDF)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('extrai texto contendo "Plano mensal"', async () => {
    jest.doMock('pdf-parse', () => (async () => ({ text: 'Plano mensal: R$ 199,90\n' })));

    // eslint-disable-next-line global-require
    const { extractPdfText } = require('../../api/services/fileExtractionService');
    const res = await extractPdfText(Buffer.from('%PDF-1.4 fake'), { timeoutMs: 15000 });

    expect(res.text).toContain('Plano mensal');
    expect(Array.isArray(res.warnings)).toBe(true);
  });
});

