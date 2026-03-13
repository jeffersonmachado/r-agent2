/**
 * Testes: worker de consistência RAG
 */

describe('RAG consistency worker', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
  });

  it('executa detectAndCleanOrphanedVectorDocuments (autoCleanOrphans)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({}),
    }));

    const TenantModel = {
      findAll: jest.fn(async () => ([{ tenant_key: 't1' }])),
    };
    const RagDocumentModel = {
      count: jest.fn(async () => 6),
    };

    jest.doMock('../../api/db/models', () => ({
      Tenant: () => TenantModel,
      RagDocument: () => RagDocumentModel,
    }));

    const detectAndCleanOrphanedVectorDocuments = jest.fn(async () => ({
      success: true,
      tenantId: 't1',
      orphanedDocumentIds: ['orphan-1'],
      removedDocuments: 1,
      removedChunks: 2,
    }));

    jest.doMock('../../api/services/ragDocumentsService', () => ({
      detectAndCleanOrphanedVectorDocuments,
      getRagHealth: jest.fn(async () => ({ ok: true, tenantId: 't1', warnings: [] })),
      reindexAllNotIndexed: jest.fn(async () => ({ success: true, total: 0, indexed: 0, failed: 0, errors: [] })),
    }));

    const worker = require('../../api/services/ragConsistencyWorker');
    const result = await worker.runOnce();

    expect(result.skipped).toBe(false);
    expect(detectAndCleanOrphanedVectorDocuments).toHaveBeenCalledWith('t1');
  });

  it('quando health aponta indexed sem chunks e autoReindex habilitado -> executa reindexAllNotIndexed(includeInconsistent=true)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({}),
    }));

    const TenantModel = {
      findAll: jest.fn(async () => ([{ tenant_key: 't1' }])),
    };
    const RagDocumentModel = {
      count: jest.fn(async () => 10),
    };

    jest.doMock('../../api/db/models', () => ({
      Tenant: () => TenantModel,
      RagDocument: () => RagDocumentModel,
    }));

    const reindexAllNotIndexed = jest.fn(async () => ({ success: true, total: 3, indexed: 3, failed: 0, errors: [] }));

    jest.doMock('../../api/services/ragDocumentsService', () => ({
      detectAndCleanOrphanedVectorDocuments: jest.fn(async () => ({ success: true, removedDocuments: 0, removedChunks: 0, orphanedDocumentIds: [] })),
      getRagHealth: jest.fn(async () => ({ ok: true, tenantId: 't1', warnings: [{ code: 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS' }] })),
      reindexAllNotIndexed,
    }));

    process.env.RAG_RECONCILE_AUTO_REINDEX_DB_AHEAD = 'true';

    const worker = require('../../api/services/ragConsistencyWorker');
    const result = await worker.runOnce();

    expect(result.skipped).toBe(false);
    expect(reindexAllNotIndexed).toHaveBeenCalledWith('t1', true);
  });
});

