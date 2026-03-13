jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('semanticContextService.extractSemanticContext', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('remove lixo OCR/hashes/tokens técnicos e popula excludedTerms', async () => {
    jest.doMock('../../api/services/contextSourceResolver', () => ({
      resolveContextSources: jest.fn(async () => ({
        used: 'inline',
        contextSources: [
          {
            text: [
              'skip to content',
              'CTX: exec-123',
              'Arquivo doc-aaaa1111bbbb2222.pdf',
              'AB CD XZ qwr',
              'Serviço: Pilates',
              'Horário: Seg a Sex 08:00-18:00',
              'Preço: R$ 120,00',
              'Contato: contato@exemplo.com',
            ].join('\n'),
          },
        ],
      })),
    }));

    jest.doMock('../../api/services/exclusions.service', () => ({
      sanitizeContext: jest.fn((x) => String(x || '')),
      getFinalExclusions: jest.fn(async () => ({ finalExclusions: ['skip to content', 'menu'] })),
      augmentExclusions: jest.fn((_a, { fileNames } = {}) => ([
        ...(Array.isArray(fileNames) ? fileNames : []),
        '.pdf',
        'doc-aaaa1111bbbb2222',
      ])),
    }));

    jest.doMock('../../api/services/questionGenerationRules.service', () => ({
      _internal: {
        detectModalitiesFromContext: jest.fn(() => (['Pilates'])),
      },
    }));

    const { extractSemanticContext } = require('../../api/services/semanticContextService');
    const ctx = await extractSemanticContext({
      tenantId: 't1',
      executionId: 'exec-123',
      dryRun: true,
      fileNames: ['doc-aaaa1111bbbb2222.pdf'],
    });

    expect(ctx).toEqual(expect.objectContaining({
      cleanText: expect.any(String),
      services: expect.arrayContaining(['Pilates']),
      prices: expect.arrayContaining(['R$ 120,00']),
      schedules: expect.arrayContaining([expect.stringContaining('08:00')]),
      contacts: expect.arrayContaining(['contato@exemplo.com']),
      excludedTerms: expect.any(Object),
    }));

    // lixo OCR removido do texto normalizado
    expect(ctx.cleanText).not.toContain('ab');
    expect(ctx.cleanText).not.toContain('cd');
    expect(ctx.cleanText).not.toContain('xz');
    expect(ctx.cleanText).not.toContain('qwr');

    // hash/ids e tokens técnicos capturados em excludedTerms
    expect(ctx.excludedTerms.hashes.join(' ')).toEqual(expect.stringContaining('aaaa1111bbbb2222'));
    expect(ctx.excludedTerms.technicalTokens).toEqual(expect.arrayContaining(['ctx:', 'doc-', '.pdf']));
    expect(ctx.excludedTerms.uiTokens).toEqual(expect.arrayContaining(['skip to content']));
    expect(ctx.excludedTerms.filenames).toEqual(expect.arrayContaining(['doc-aaaa1111bbbb2222.pdf']));
  });
});

