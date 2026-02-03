/**
 * Teste: limpeza de órfãos quando vector store tem docs a mais (vector_ahead).
 */

describe('RAG clean orphans', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('detectAndCleanOrphanedVectorDocuments remove ids que não existem no BD', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({
        query: jest.fn(async () => ([[{ chunks: 10 }]])),
      }),
    }));

    const listOrphanedDocumentIdsForTenant = jest.fn(async () => (['orphan-1', 'orphan-2']));
    const deleteOrphanedChunksForTenant = jest.fn(async () => ({ success: true }));
    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => ({
      listOrphanedDocumentIdsForTenant,
      deleteOrphanedChunksForTenant,
    }));

    const ragDocumentsService = require('../../api/services/ragDocumentsService');
    const result = await ragDocumentsService.detectAndCleanOrphanedVectorDocuments('t1');

    expect(result.success).toBe(true);
    expect(result.orphanedDocumentIds.sort()).toEqual(['orphan-1', 'orphan-2']);
    expect(listOrphanedDocumentIdsForTenant).toHaveBeenCalledWith('t1', 50000);
    expect(deleteOrphanedChunksForTenant).toHaveBeenCalledWith('t1');
    expect(result.removedChunks).toBe(10);
  });

  it('quando não há órfãos -> retorna removed=0', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => null,
    }));

    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => ({
      listOrphanedDocumentIdsForTenant: jest.fn(async () => ([])),
      deleteOrphanedChunksForTenant: jest.fn(async () => ({ success: true })),
    }));

    const ragDocumentsService = require('../../api/services/ragDocumentsService');

    const result = await ragDocumentsService.detectAndCleanOrphanedVectorDocuments('t1');

    expect(result.success).toBe(true);
    expect(result.orphanedDocumentIds).toEqual([]);
    expect(result.removedDocuments).toBe(0);
    expect(result.removedChunks).toBe(0);
  });
});

