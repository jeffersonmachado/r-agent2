'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('suggestDescriptionService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rejects hostile tenantId coercion with required error', async () => {
    jest.doMock('../../api/services/ragContextBuilder', () => ({
      buildDiverseRagContext: jest.fn(async () => ({ contextSources: [], contextSummary: null, notes: [], ragContext: '' })),
    }));
    jest.doMock('../../api/services/entityProfileService', () => ({
      buildEntityProfile: jest.fn(async () => ({ profile: { confidence: 0.2 } })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: 'ok' })),
    }));
    jest.doMock('../../api/services/tenantService', () => ({ getTenant: jest.fn(async () => null) }));
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      getEphemeralContext: jest.fn(async () => ({ found: false, used: false, chunks: [] })),
    }));

    const { suggestDescription } = require('../../api/services/suggestDescriptionService');

    await expect(suggestDescription({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      mode: 'technical',
      contextMode: 'persisted',
    })).rejects.toThrow('tenantId é obrigatório');
  });

  test('tolerates hostile hash/chunkId coercion during context merge', async () => {
    const buildDiverseRagContext = jest
      .fn()
      .mockResolvedValueOnce({
        contextSources: [
          {
            sourceType: 'uploaded_file',
            sourceId: 'file:a.pdf',
            score: 0.9,
            text: 'Servicos e atendimento com foco no cliente.',
            excerpt: 'Servicos e atendimento com foco no cliente.',
            hash: { toString: () => { throw new Error('boom-hash-1'); } },
            chunkId: { toString: () => { throw new Error('boom-chunk-1'); } },
          },
        ],
        contextSummary: { total: 1, uploaded: 1, web: 0, uploadedSources: ['file:a.pdf'], webSources: [], topScores: { uploaded: [0.9], web: [] } },
        notes: ['first pass'],
        ragContext: '',
      })
      .mockResolvedValueOnce({
        contextSources: [
          {
            sourceType: 'web_scraping',
            sourceId: 'https://empresa.test/contato',
            score: 0.8,
            text: 'Contato: (11) 99999-9999 e email contato@empresa.test',
            excerpt: 'Contato: (11) 99999-9999 e email contato@empresa.test',
            hash: { toString: () => { throw new Error('boom-hash-2'); } },
            chunkId: { toString: () => { throw new Error('boom-chunk-2'); } },
          },
        ],
        contextSummary: { total: 1, uploaded: 0, web: 1, uploadedSources: [], webSources: ['https://empresa.test/contato'], topScores: { uploaded: [], web: [0.8] } },
        notes: ['second pass'],
        ragContext: '',
      });

    jest.doMock('../../api/services/ragContextBuilder', () => ({ buildDiverseRagContext }));
    jest.doMock('../../api/services/entityProfileService', () => ({
      buildEntityProfile: jest.fn(async () => ({
        profile: {
          name: 'Empresa Teste',
          confidence: 0.8,
          contacts: { phone: '(11) 99999-9999', whatsapp: null, email: 'contato@empresa.test' },
          channels: { instagram: null, facebook: null, maps: null },
          paymentMethods: ['PIX'],
          productsServices: ['Atendimento'],
          differentials: [],
          proofPoints: [],
          whatItDoes: 'atua com atendimento',
        },
      })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: 'Relatorio tecnico' })),
    }));
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa Teste', site: 'https://empresa.test' })),
    }));
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      getEphemeralContext: jest.fn(async () => ({ found: false, used: false, chunks: [] })),
    }));

    const { suggestDescription } = require('../../api/services/suggestDescriptionService');

    const out = await suggestDescription({
      tenantId: 't1',
      mode: 'technical',
      contextMode: 'persisted',
      urls: ['https://empresa.test'],
      fileNames: ['a.pdf'],
    });

    expect(out).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        mode: 'technical',
        suggestion: expect.any(String),
      }),
      warnings: expect.any(Array),
    }));
    expect(buildDiverseRagContext).toHaveBeenCalledTimes(2);
  });

  test('technical mode fallback tolerates hostile generateAiResponse error.message getter', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/ragContextBuilder', () => ({
      buildDiverseRagContext: jest.fn(async () => ({
        contextSources: [
          {
            sourceType: 'uploaded_file',
            sourceId: 'file:a.pdf',
            score: 0.9,
            text: 'Atendimento com foco no cliente e planos mensais.',
            excerpt: 'Atendimento com foco no cliente e planos mensais.',
            hash: 'h1',
            chunkId: 'c1',
          },
        ],
        contextSummary: { total: 1, uploaded: 1, web: 0, uploadedSources: ['file:a.pdf'], webSources: [], topScores: { uploaded: [0.9], web: [] } },
        notes: [],
        ragContext: '',
      })),
    }));
    jest.doMock('../../api/services/entityProfileService', () => ({
      buildEntityProfile: jest.fn(async () => ({
        profile: {
          name: 'Empresa Teste',
          confidence: 0.85,
          contacts: { phone: '(11) 99999-9999', whatsapp: null, email: 'contato@empresa.test' },
          channels: { instagram: null, facebook: null, maps: null },
          paymentMethods: ['PIX'],
          productsServices: ['Atendimento'],
          differentials: [],
          proofPoints: [],
          whatItDoes: 'atua com atendimento',
        },
      })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => {
        throw hostileError;
      }),
    }));
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa Teste', site: 'https://empresa.test' })),
    }));
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      getEphemeralContext: jest.fn(async () => ({ found: false, used: false, chunks: [] })),
    }));

    const { suggestDescription } = require('../../api/services/suggestDescriptionService');

    const out = await suggestDescription({
      tenantId: 't1',
      mode: 'technical',
      contextMode: 'persisted',
      urls: ['https://empresa.test'],
      fileNames: ['a.pdf'],
    });

    expect(out.payload.mode).toBe('technical');
    expect(out.payload.suggestion).toContain('MODO TÉCNICO (AUDITORIA)');
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/suggestDescriptionService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
