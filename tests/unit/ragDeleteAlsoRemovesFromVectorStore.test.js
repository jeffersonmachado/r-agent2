/**
 * Garante que deletar documento também remove do vector store (best-effort),
 * evitando inconsistência "vector_ahead" após exclusões.
 */

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({ query: jest.fn(async () => [[{ current_version: null }]]) }),
}));

const mockRows = new Map();
const mockRowFor = (id) => {
  const current = mockRows.get(id);
  if (!current) return null;
  return {
    ...current,
    dataValues: current,
    toJSON: () => ({ ...mockRows.get(id) }),
    update: async (payload) => mockRows.set(id, { ...mockRows.get(id), ...payload }),
  };
};

jest.mock('../../api/db/models', () => ({
  RagDocument: () => ({
    findByPk: async (id) => mockRowFor(String(id)),
    findOne: async ({ where }) => {
      const row = mockRowFor(String(where.id));
      return row && row.tenant_key === where.tenant_key ? row : null;
    },
    create: async (payload) => {
      mockRows.set(String(payload.id), { ...payload });
      return mockRowFor(String(payload.id));
    },
    destroy: async ({ where }) => {
      const row = mockRows.get(String(where.id));
      if (!row || (where.tenant_key && row.tenant_key !== where.tenant_key)) return 0;
      mockRows.delete(String(where.id));
      return 1;
    },
  }),
  RagDocumentFile: () => ({
    destroy: async () => 0,
  }),
}));

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

    const unscopedDelete = await ragDocumentsService.deleteDocument(docId);
    expect(unscopedDelete).toMatchObject({ success: false, errorCode: 'TENANT_REQUIRED' });
    expect(postgresVectorStore.deleteDocumentVectors).not.toHaveBeenCalled();

    const del = await ragDocumentsService.deleteDocument(docId, tenantId);
    expect(del.success).toBe(true);

    expect(postgresVectorStore.deleteDocumentVectors).toHaveBeenCalledWith({ tenantId, documentId: String(docId) });
  });
});
