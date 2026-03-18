jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => null,
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

    expect(() => ragDocumentsService.listDocuments({ tenantId: 'tenant-safe', search: hostileSearch })).not.toThrow();
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

    const result = ragDocumentsService.listDocuments({ tenantId: 'tenant-safe-2', search: 'vendas' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
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

    const result = await ragDocumentsService.deleteDocument(hostileId);
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
