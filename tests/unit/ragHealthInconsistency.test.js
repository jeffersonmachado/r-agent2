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
      getSequelize: () => ({}),
    }));

    const updateCalls = [];

    const RagDocumentModel = {
      count: jest.fn(async () => 0),
      update: jest.fn(async (payload) => {
        updateCalls.push(payload);
        return [6];
      }),
      findByPk: jest.fn(async () => null),
      create: jest.fn(async () => null),
      destroy: jest.fn(async () => 0),
    };

    jest.doMock('../../api/db/models', () => ({
      RagDocument: () => RagDocumentModel,
    }));

    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => ({
      countVectorDocs: jest.fn(async () => ({ documents: 0, chunks: 0 })),
      countChunksByDocument: jest.fn(async () => ({})), // doc sem chunks
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
    const reindexRes = await ragDocumentsService.reindexDocument('doc-1');
    expect(reindexRes.success).toBe(true);

    const health = await ragDocumentsService.getRagHealth('tenant-1', { autoRepair: false });
    expect(health.ok).toBe(true);
    expect(Array.isArray(health.warnings)).toBe(true);
    expect(health.warnings.some((w) => w.code === 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS')).toBe(true);

    // Deve tentar marcar inconsistência no BD
    expect(RagDocumentModel.update).toHaveBeenCalled();
    expect(updateCalls.some((p) => p && p.inconsistent === true)).toBe(true);
  });
});

