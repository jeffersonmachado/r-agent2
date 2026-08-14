const mockRagRows = new Map();

function mockRowFor(id) {
  const current = mockRagRows.get(id);
  if (!current) return null;
  return {
    ...current,
    dataValues: current,
    toJSON: () => ({ ...mockRagRows.get(id) }),
    update: async (payload) => {
      mockRagRows.set(id, { ...mockRagRows.get(id), ...payload });
    },
  };
}

const mockRagDocumentModel = {
  findByPk: async (id) => mockRowFor(String(id)),
  findOne: async ({ where }) => {
    const row = mockRowFor(String(where.id));
    return row && row.tenant_key === where.tenant_key ? row : null;
  },
  findAll: async ({ where = {} } = {}) => Array.from(mockRagRows.keys())
    .filter((id) => !where.tenant_key || mockRagRows.get(id).tenant_key === where.tenant_key)
    .filter((id) => !Array.isArray(where.id) || where.id.includes(id))
    .map(mockRowFor),
  create: async (payload) => {
    mockRagRows.set(String(payload.id), { ...payload });
    return mockRowFor(String(payload.id));
  },
  destroy: async ({ where }) => {
    const row = mockRagRows.get(String(where.id));
    if (!row || (where.tenant_key && row.tenant_key !== where.tenant_key)) return 0;
    mockRagRows.delete(String(where.id));
    return 1;
  },
};

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({
    query: async (_sql, { replacements = {} } = {}) => {
      const term = String(replacements.pattern || '').replaceAll('%', '').replaceAll('\\', '').toLowerCase();
      const rows = Array.from(mockRagRows.values())
        .filter((row) => !replacements.tenantId || row.tenant_key === replacements.tenantId)
        .filter((row) => !term || `${row.title || ''} ${row.content || ''}`.toLowerCase().includes(term))
        .map((row) => ({ id: row.id }));
      return [rows];
    },
  }),
}));

jest.mock('../../api/db/models', () => ({
  RagDocument: () => mockRagDocumentModel,
  RagDocumentFile: () => ({
    findByPk: async () => null,
    findOne: async () => null,
    create: async () => null,
    destroy: async () => 0,
  }),
}));

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../../api/services/ragService', () => ({
  indexDocument: jest.fn(async () => ({ success: true, documentId: 'x', chunksCreated: 1 })),
}));

jest.mock('../../api/services/ragDeduplicationService', () => ({
  getCurrentSourceVersion: jest.fn(() => 0),
  generateContentHash: jest.fn(async () => 'hash-1'),
}));

jest.mock('../../api/services/vectorStore/postgresVectorStore', () => ({
  deleteDocumentVectors: jest.fn(async () => ({ success: true })),
  listOrphanedDocumentIdsForTenant: jest.fn(async () => []),
  deleteOrphanedChunksForTenant: jest.fn(async () => ({ success: true })),
}));

const ragDocumentsService = require('../../api/services/ragDocumentsService');

describe('ragDocumentsService - defensive coercions', () => {
  it('listDocuments tolerates hostile search values', async () => {
    await ragDocumentsService.createDocument(
      {
        id: `doc-safe-${Date.now()}`,
        title: 'Documento Seguro',
        content: 'conteudo de teste',
        metadata: { source: 'manual' },
        autoIndex: false,
      },
      'tenant-safe',
      { skipDuplicateCheck: true }
    );

    const hostileSearch = {
      toString() {
        throw new Error('search toString exploded');
      },
    };

    await expect(
      ragDocumentsService.listDocuments({ tenantId: 'tenant-safe', search: hostileSearch })
    ).resolves.toBeInstanceOf(Array);
  });

  it('listDocuments keeps nominal search behavior with mixed data', async () => {
    await ragDocumentsService.createDocument(
      {
        id: `doc-nominal-${Date.now()}`,
        title: 'Manual de Vendas',
        content: 'playbook comercial',
        metadata: { source: 'manual' },
        autoIndex: false,
      },
      'tenant-safe-2',
      { skipDuplicateCheck: true }
    );

    const result = await ragDocumentsService.listDocuments({ tenantId: 'tenant-safe-2', search: 'vendas' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('listDocuments applies optional limit/offset pagination', async () => {
    const tenant = 'tenant-paged';
    for (let i = 0; i < 3; i += 1) {
      await ragDocumentsService.createDocument(
        {
          id: `doc-paged-${i}-${Date.now()}`,
          title: `Doc Paginado ${i}`,
          content: `conteudo ${i}`,
          metadata: { source: 'manual' },
          autoIndex: false,
        },
        tenant,
        { skipDuplicateCheck: true }
      );
    }

    const all = await ragDocumentsService.listDocuments({ tenantId: tenant });
    expect(all.length).toBe(3);

    const limited = await ragDocumentsService.listDocuments({ tenantId: tenant, limit: 2 });
    expect(limited.length).toBe(2);
    expect(limited[0].id).toBe(all[0].id);

    const offset = await ragDocumentsService.listDocuments({ tenantId: tenant, offset: 2 });
    expect(offset.length).toBe(1);
    expect(offset[0].id).toBe(all[2].id);
  });

  it('findDocumentByUrl tolerates hostile URL values', () => {
    const hostileUrl = {
      toString() {
        throw new Error('url toString exploded');
      },
    };

    expect(() => ragDocumentsService.findDocumentByUrl(hostileUrl, 'tenant-safe')).not.toThrow();
    expect(ragDocumentsService.findDocumentByUrl(hostileUrl, 'tenant-safe')).toBeNull();
  });

  it('findDocumentByUrl keeps nominal case-insensitive matching', async () => {
    const docId = `doc-url-${Date.now()}`;
    const created = await ragDocumentsService.createDocument(
      {
        id: docId,
        title: 'Documento URL',
        content: 'conteudo',
        metadata: { source: 'web', url: 'https://Example.com/Produto' },
        autoIndex: false,
      },
      'tenant-safe-url',
      { skipDuplicateCheck: true }
    );

    expect(created.success).toBe(true);
    const found = ragDocumentsService.findDocumentByUrl('  https://example.com/produto  ', 'tenant-safe-url');
    expect(found).toBeTruthy();
    expect(found.id).toBe(docId);
  });

  it('findDocumentByFileName tolerates hostile input values', async () => {
    const docId = `doc-file-${Date.now()}`;
    const created = await ragDocumentsService.createDocument(
      {
        id: docId,
        title: 'Arquivo',
        content: 'x',
        metadata: { source: 'upload', fileName: 'Arquivo.PDF', fileSize: 123 },
        autoIndex: false,
      },
      'tenant-safe-3',
      { skipDuplicateCheck: true }
    );
    expect(created.success).toBe(true);

    const hostileInputFileName = {
      toString() {
        throw new Error('input filename exploded');
      },
    };

    expect(() => ragDocumentsService.findDocumentByFileName(hostileInputFileName, 'tenant-safe-3')).not.toThrow();
    expect(ragDocumentsService.findDocumentByFileName(hostileInputFileName, 'tenant-safe-3')).toBeNull();

    const found = ragDocumentsService.findDocumentByFileName('  arquivo.pdf ', 'tenant-safe-3', 123);
    expect(found).toBeTruthy();
    expect(found.id).toBe(docId);
  });

  it('deleteDocument tolerates hostile documentId coercion', async () => {
    const hostileId = {
      toString() {
        throw new Error('documentId toString exploded');
      },
    };

    const result = await ragDocumentsService.deleteDocument(hostileId, 'tenant-safe-3');
    expect(result.success).toBe(true);
  });

  it('não mantém acessos diretos a err/error.message fora do helper', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/ragDocumentsService.js'),
      'utf-8'
    );

    const lines = content.split('\n');
    const offenders = [];

    for (const line of lines) {
      if (!/\b(err|error)\.message\b/.test(line)) continue;
      if (line.includes('String(err.message)')) continue; // safeErrorMessage helper internals
      offenders.push(line.trim());
    }

    expect(offenders).toEqual([]);
  });
});
