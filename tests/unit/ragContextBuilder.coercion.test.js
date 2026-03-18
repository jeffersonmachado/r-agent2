'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { buildDiverseRagContext } = require('../../api/services/ragContextBuilder');

describe('ragContextBuilder coercion hardening', () => {
  test('throws query obrigatoria for hostile query coercion', async () => {
    await expect(buildDiverseRagContext({
      query: { toString: () => { throw new Error('boom-query'); } },
      tenantId: 't1',
      ragQueryFn: jest.fn(async () => ({ success: true, sources: [] })),
    })).rejects.toThrow('query é obrigatória');
  });

  test('tolerates hostile chunkId coercion in source rows', async () => {
    const ragQueryFn = jest.fn(async () => ({
      success: true,
      sources: [
        {
          chunkId: { toString: () => { throw new Error('boom-chunk'); } },
          score: 0.9,
          excerpt: 'Texto relevante sobre produtos e atendimento ao cliente.',
          metadata: {
            source: 'web_scraping',
            url: 'https://acme.test/sobre',
            source_id: 'https://acme.test/sobre',
          },
        },
      ],
    }));

    const out = await buildDiverseRagContext({
      query: 'empresa acme',
      tenantId: 't1',
      totalK: 5,
      minUploaded: 0,
      minWeb: 0,
      minScore: 0.2,
      ragQueryFn,
    });

    expect(out).toEqual(expect.objectContaining({
      ragContext: expect.any(String),
      contextSources: expect.any(Array),
    }));
    expect(out.contextSources.length).toBeGreaterThan(0);
  });

  test('tolerates hostile error.message getter from ragDocumentsService enrichment failure', async () => {
    jest.resetModules();

    jest.doMock('../../api/services/ragDocumentsService', () => ({
      getDocument: jest.fn(() => {
        const hostileError = {
          get message() {
            throw new Error('poisoned message getter');
          },
          toString() {
            throw new Error('poisoned toString');
          },
        };
        throw hostileError;
      }),
    }));

    const { buildDiverseRagContext: build } = require('../../api/services/ragContextBuilder');

    const out = await build({
      query: 'empresa acme',
      tenantId: 't1',
      totalK: 5,
      minUploaded: 0,
      minWeb: 0,
      minScore: 0.2,
      ragQueryFn: jest.fn(async () => ({
        success: true,
        sources: [
          {
            documentId: 'doc-1',
            score: 0.91,
            excerpt: 'Texto relevante sobre atendimento e produtos para clientes.',
            metadata: {},
          },
        ],
      })),
    });

    expect(out).toEqual(expect.objectContaining({
      ragContext: expect.any(String),
      contextSources: expect.any(Array),
    }));
    expect(out.contextSources.length).toBeGreaterThan(0);
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ragContextBuilder.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
