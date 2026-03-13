/**
 * Testes: index fail -> DB status failed
 */

describe('RAG index state', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('index fail (0 chunks) -> grava index_status=failed no DB', async () => {
    // Mock DB disponível
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({}),
    }));

    // Mock ragService (indexação retorna 0 chunks)
    jest.doMock('../../api/services/ragService', () => ({
      indexDocument: jest.fn().mockResolvedValue({
        success: true,
        documentId: 'doc-1',
        chunksCreated: 0,
        error: null,
      }),
      isRagAvailable: jest.fn().mockResolvedValue(true),
      getRagServiceUrl: jest.fn().mockReturnValue('http://localhost:8001'),
    }));

    const createdRows = new Map();
    const updates = [];

    const RagDocumentModel = {
      findByPk: jest.fn(async (id) => {
        const row = createdRows.get(id);
        if (!row) return null;
        return {
          update: async (payload) => {
            updates.push({ id, payload });
            createdRows.set(id, { ...row, ...payload });
          },
          toJSON: () => createdRows.get(id),
          dataValues: createdRows.get(id),
        };
      }),
      create: jest.fn(async (payload) => {
        createdRows.set(payload.id, payload);
        return {
          toJSON: () => payload,
          dataValues: payload,
        };
      }),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => [0]),
      destroy: jest.fn(async () => 0),
    };

    jest.doMock('../../api/db/models', () => ({
      RagDocument: () => RagDocumentModel,
    }));

    const ragDocumentsService = require('../../api/services/ragDocumentsService');

    // cria documento (sem autoIndex) para existir no DB
    const createRes = await ragDocumentsService.createDocument(
      { title: 'Doc', content: 'Conteúdo', autoIndex: false },
      'tenant-1'
    );
    expect(createRes.success).toBe(true);

    // flush persistência (setImmediate)
    jest.runOnlyPendingTimers();
    await Promise.resolve();

    // agora reindex (que deve falhar com 0 chunks)
    const reindexRes = await ragDocumentsService.reindexDocument(createRes.document.id);
    expect(reindexRes.success).toBe(false);
    expect(reindexRes.chunksCreated).toBe(0);

    // flush persistência pós reindex
    jest.runOnlyPendingTimers();
    await Promise.resolve();

    // valida que última atualização no "DB" tem estado failed
    const lastUpdate = updates[updates.length - 1];
    expect(lastUpdate).toBeTruthy();
    expect(lastUpdate.payload.index_status).toBe('failed');
    expect(lastUpdate.payload.index_error_code).toBe('RAG_INDEX_FAILED');
  });
});

