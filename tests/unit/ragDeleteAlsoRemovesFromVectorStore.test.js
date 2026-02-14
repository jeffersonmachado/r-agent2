/**
 * Garante que deletar documento também remove do vector store (best-effort),
 * evitando inconsistência "vector_ahead" após exclusões.
 */

jest.mock('../../api/services/ragService', () => ({
  // Necessário para o getRagService() não quebrar (ele valida indexDocument)
  indexDocument: jest.fn(async () => ({ success: true, documentId: 'x', chunksCreated: 1 })),
}));

jest.mock('../../api/services/vectorStore/postgresVectorStore', () => ({
  deleteDocumentVectors: jest.fn(async () => ({ success: true })),
}));

const postgresVectorStore = require('../../api/services/vectorStore/postgresVectorStore');
const ragDocumentsService = require('../../api/services/ragDocumentsService');

describe('RAG delete -> remove do vector store', () => {
  it('chama cleanOrphanedDocuments(tenantId, [documentId]) ao deletar', async () => {
    const tenantId = 'tenant-1';
    const docId = `doc-${Date.now()}`;

    // cria no cache
    const created = await ragDocumentsService.createDocument(
      { id: docId, title: 'Doc', content: 'conteúdo', metadata: { source: 'manual' }, autoIndex: false },
      tenantId,
      { skipDuplicateCheck: true }
    );

    expect(created.success).toBe(true);
    expect(created.document.id).toBe(docId);
    expect(created.document.tenantId).toBe(tenantId);

    const del = await ragDocumentsService.deleteDocument(docId);
    expect(del.success).toBe(true);

    expect(postgresVectorStore.deleteDocumentVectors).toHaveBeenCalledWith({ tenantId, documentId: String(docId) });
  });
});

