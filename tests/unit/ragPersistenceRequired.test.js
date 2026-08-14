'use strict';

describe('RAG documents require durable PostgreSQL persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => null }));
    jest.doMock('../../api/utils/logger', () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.dontMock('../../api/db/sequelize');
    jest.dontMock('../../api/utils/logger');
  });

  test('create não retorna sucesso nem grava apenas em memória quando DB está indisponível', async () => {
    const service = require('../../api/services/ragDocumentsService');
    const result = await service.createDocument({
      id: 'must-not-be-cached',
      title: 'Documento',
      content: 'conteúdo',
      autoIndex: false,
    }, 'tenant-a', { skipDuplicateCheck: true });

    expect(result).toMatchObject({
      success: false,
      document: null,
      errorCode: 'PERSISTENCE_REQUIRED',
      error: 'persistence_required',
    });
    expect(service.getDocument('must-not-be-cached')).toBeNull();
  });

  test('listagem falha explicitamente sem DB em vez de servir cache potencialmente obsoleto', async () => {
    const service = require('../../api/services/ragDocumentsService');
    await expect(service.listDocuments({ tenantId: 'tenant-a' }))
      .rejects.toMatchObject({ code: 'PERSISTENCE_REQUIRED' });
  });
});
