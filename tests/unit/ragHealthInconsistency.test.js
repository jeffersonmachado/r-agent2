/**
 * Testes: /rag/health (Node) detecta doc indexed sem chunks no Postgres
 */

describe('RAG health inconsistency', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('quando doc está indexed mas chunks=0 no Postgres -> warnings + marca inconsistente', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({ query: jest.fn(async () => [[{ current_version: null }]]) }),
    }));

    const updateCalls = [];
    const rows = new Map();

    const rowFor = (id) => {
      const current = rows.get(id);
      if (!current) return null;
      return {
        ...current,
        dataValues: current,
        toJSON: () => ({ ...rows.get(id) }),
        update: async (payload) => rows.set(id, { ...rows.get(id), ...payload }),
      };
    };

    const RagDocumentModel = {
      count: jest.fn(async () => 0),
      update: jest.fn(async (payload) => {
        updateCalls.push(payload);
        return [6];
      }),
      findByPk: jest.fn(async (id) => rowFor(id)),
      findOne: jest.fn(async ({ where }) => {
        const row = rowFor(where.id);
        return row && row.tenant_key === where.tenant_key ? row : null;
      }),
      findAll: jest.fn(async ({ where = {} } = {}) => Array.from(rows.keys())
        .filter((id) => !where.tenant_key || rows.get(id).tenant_key === where.tenant_key)
        .map(rowFor)),
      create: jest.fn(async (payload) => {
        rows.set(payload.id, { ...payload });
        return rowFor(payload.id);
      }),
      destroy: jest.fn(async () => 0),
    };

    jest.doMock('../../api/db/models', () => ({
      RagDocument: () => RagDocumentModel,
    }));

    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => ({
      countVectorDocs: jest.fn(async () => ({ documents: 0, chunks: 0 })),
      countChunksByDocument: jest.fn(async () => ({})), // doc sem chunks
      countChunksWithEmbeddingByDocument: jest.fn(async () => ({})),
      deleteDocumentVectors: jest.fn(async () => ({ success: true })),
    }));

    jest.doMock('../../api/services/ragService', () => ({
      indexDocument: jest.fn(async () => ({ success: true, documentId: 'doc-1', chunksCreated: 1 })),
      isRagAvailable: jest.fn(async () => true),
      getRagServiceUrl: jest.fn(() => 'http://localhost:8001'),
    }));

    const ragDocumentsService = require('../../api/services/ragDocumentsService');

    const createRes = await ragDocumentsService.createDocument(
      { id: 'doc-1', title: 'Doc', content: 'conteúdo', autoIndex: false },
      'tenant-1',
      { skipDuplicateCheck: true }
    );
    expect(createRes.success).toBe(true);

    // força estado indexed no cache
    const reindexRes = await ragDocumentsService.reindexDocument('doc-1', 'tenant-1');
    expect(reindexRes.success).toBe(true);

    const health = await ragDocumentsService.getRagHealth('tenant-1', { autoRepair: false });
    expect(health.ok).toBe(true);
    expect(Array.isArray(health.warnings)).toBe(true);
    expect(health.warnings.some((w) => w.code === 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS')).toBe(true);

    // Deve tentar marcar inconsistência no BD
    expect(RagDocumentModel.update).toHaveBeenCalled();
    expect(updateCalls.some((p) => p && p.inconsistent === true)).toBe(true);
  });

  it('quando doc está pending mas tem chunks vetorizados -> auto-repara para indexed', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({ query: jest.fn(async () => [[{ current_version: null }]]) }),
    }));

    const rows = new Map();
    const rowFor = (id) => {
      const current = rows.get(id);
      if (!current) return null;
      return {
        ...current,
        dataValues: current,
        toJSON: () => ({ ...rows.get(id) }),
        update: async (payload) => rows.set(id, { ...rows.get(id), ...payload }),
      };
    };

    const RagDocumentModel = {
      count: jest.fn(async () => 0),
      update: jest.fn(async () => [0]),
      findByPk: jest.fn(async (id) => rowFor(id)),
      findOne: jest.fn(async ({ where }) => {
        const row = rowFor(where.id);
        return row && row.tenant_key === where.tenant_key ? row : null;
      }),
      findAll: jest.fn(async ({ where = {} } = {}) => Array.from(rows.keys())
        .filter((id) => !where.tenant_key || rows.get(id).tenant_key === where.tenant_key)
        .map(rowFor)),
      create: jest.fn(async (payload) => {
        rows.set(payload.id, { ...payload });
        return rowFor(payload.id);
      }),
      destroy: jest.fn(async () => 0),
    };

    jest.doMock('../../api/db/models', () => ({
      RagDocument: () => RagDocumentModel,
    }));

    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => ({
      countVectorDocs: jest.fn(async () => ({ documents: 1, chunks: 3 })),
      countChunksByDocument: jest.fn(async () => ({ 'doc-1': 3 })),
      countChunksWithEmbeddingByDocument: jest.fn(async () => ({ 'doc-1': 3 })),
      deleteDocumentVectors: jest.fn(async () => ({ success: true })),
    }));

    jest.doMock('../../api/services/ragService', () => ({
      indexDocument: jest.fn(async () => ({ success: true, documentId: 'doc-1', chunksCreated: 3 })),
      isRagAvailable: jest.fn(async () => true),
      getRagServiceUrl: jest.fn(() => 'http://localhost:8001'),
    }));

    const ragDocumentsService = require('../../api/services/ragDocumentsService');

    const createRes = await ragDocumentsService.createDocument(
      { id: 'doc-1', title: 'Doc', content: 'conteúdo', autoIndex: false },
      'tenant-1',
      { skipDuplicateCheck: true }
    );
    expect(createRes.success).toBe(true);

    const health = await ragDocumentsService.getRagHealth('tenant-1', { autoRepair: false });
    expect(health.ok).toBe(true);
    expect(health.warnings.some((w) => w.code === 'RAG_STALE_INDEX_STATUS_WITH_CHUNKS')).toBe(true);
    expect(rows.get('doc-1').index_status).toBe('indexed');
  });
});
