'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function mockSequelize(queryImpl) {
  const query = jest.fn(queryImpl);
  jest.doMock('../../api/db/sequelize', () => ({
    getSequelize: () => ({ query }),
  }));
  return query;
}

function mockContentNormalization() {
  jest.doMock('../../api/utils/contentNormalization', () => ({
    normalizeContent: jest.fn((value) => String(value || '')),
    generateContentHash: jest.fn(async () => 'content-hash'),
    generateContentHashSync: jest.fn(() => 'content-hash'),
    generateChunkId: jest.fn(() => 'chunk-generated'),
    generateSemanticHash: jest.fn(() => 'semantic-hash'),
    normalizeEmbedding: jest.fn((embedding) => embedding),
    cosineSimilarity: jest.fn(() => 0),
  }));
}

describe('ragDeduplicationService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('checkStructuralDuplicate detecta duplicata via consulta ao Postgres', async () => {
    const query = mockSequelize(async () => ([[
      {
        id: 'chunk-1',
        document_id: 'doc-1',
        metadata: { content_hash: 'content-hash-1', source_id: 'src-1', active: true },
      },
    ]]));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const out = await svc.checkStructuralDuplicate('tenant-1', 'content-hash-1', 'src-2');

    expect(out.isDuplicate).toBe(true);
    expect(out.reason).toBe('content_hash_duplicate');
    expect(out.existingChunk.chunk_id).toBe('chunk-1');
    expect(out.existingChunk.document_id).toBe('doc-1');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, opts] = query.mock.calls[0];
    expect(sql).toContain("metadata->>'content_hash'");
    expect(opts.replacements).toEqual({ tenantKey: 'tenant-1', contentHash: 'content-hash-1' });
  });

  test('checkStructuralDuplicate retorna não-duplicado quando DB não encontra hash', async () => {
    mockSequelize(async () => ([[]]));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const out = await svc.checkStructuralDuplicate('tenant-1', 'content-hash-1');

    expect(out).toEqual({ isDuplicate: false });
  });

  test('checkSemanticDuplicate detecta duplicata exata por semantic_hash no DB', async () => {
    mockSequelize(async () => ([[
      { id: 'chunk-1', document_id: 'doc-1', metadata: { semantic_hash: 'semantic-hash-1' } },
    ]]));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const out = await svc.checkSemanticDuplicate('tenant-1', [0.2, 0.3], 'semantic-hash-1', 'src-2');

    expect(out.isDuplicate).toBe(true);
    expect(out.similarity).toBe(1.0);
    expect(out.reason).toBe('semantic_hash_exact_duplicate');
  });

  test('checkSemanticDuplicate detecta similaridade > 0.97 via distância pgvector', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('ORDER BY embedding')) {
        return [[{ id: 'chunk-9', document_id: 'doc-9', metadata: {}, distance: 0.01 }]];
      }
      return [[]];
    });
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({ query }) }));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const out = await svc.checkSemanticDuplicate('tenant-1', [0.2, 0.3], 'semantic-hash-2', 'src-2');

    expect(out.isDuplicate).toBe(true);
    expect(out.reason).toBe('semantic_similarity_duplicate');
    expect(out.similarity).toBeCloseTo(0.99, 5);
    expect(out.existingChunk.chunk_id).toBe('chunk-9');
  });

  test('checkSemanticDuplicate retorna não-duplicado quando DB não tem chunks similares', async () => {
    mockSequelize(async () => ([[]]));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const out = await svc.checkSemanticDuplicate('tenant-1', [0.2, 0.3], 'semantic-hash-2', 'src-2');

    expect(out).toEqual({ isDuplicate: false, similarity: 0 });
  });

  test('falha de DB propaga erro explícito (sem fallback silencioso)', async () => {
    mockSequelize(async () => {
      throw new Error('connection refused');
    });
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');

    await expect(svc.checkStructuralDuplicate('tenant-1', 'hash')).rejects.toThrow('connection refused');
    await expect(svc.checkSemanticDuplicate('tenant-1', [0.1], 'hash')).rejects.toThrow('connection refused');
    await expect(svc.getCurrentSourceVersion('tenant-1', 'src-1')).rejects.toThrow('connection refused');
    await expect(svc.getDeduplicationStats('tenant-1')).rejects.toThrow('connection refused');
  });

  test('getCurrentSourceVersion retorna MAX(source_version) ou 1', async () => {
    const query = jest.fn(async () => ([[{ current_version: 3 }]]));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({ query }) }));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    await expect(svc.getCurrentSourceVersion('tenant-1', 'src-1')).resolves.toBe(3);

    query.mockImplementation(async () => ([[{ current_version: null }]]));
    await expect(svc.getCurrentSourceVersion('tenant-1', 'src-new')).resolves.toBe(1);
  });

  test('tenantId hostil (toString que lança) gera TENANT_REQUIRED, sem crash de coerção', async () => {
    mockSequelize(async () => ([[]]));
    mockContentNormalization();

    const svc = require('../../api/services/ragDeduplicationService');
    const hostileTenantId = {
      toString() {
        throw new Error('poisoned toString');
      },
    };

    await expect(svc.checkStructuralDuplicate(hostileTenantId, 'hash'))
      .rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ragDeduplicationService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
