/**
 * Testes para fileRagService.js
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { indexFilesInRag, getFileCategory } = require('../fileRagService');
const ragDocumentsService = require('../../../api/services/ragDocumentsService');

// Mock do serviço de documentos RAG
jest.mock('../../../api/services/ragDocumentsService');

describe('fileRagService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('indexFilesInRag', () => {
    it('deve indexar arquivo com conteúdo válido', async () => {
      ragDocumentsService.createDocument.mockResolvedValue({
        success: true,
        document: {
          id: 'doc-123',
          title: 'test.txt',
        },
      });

      const files = [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo de teste',
        },
      ];

      const results = await indexFilesInRag(files, 'test-tenant');

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].documentId).toBe('doc-123');
      expect(ragDocumentsService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'test.txt',
          content: 'Conteúdo de teste',
          metadata: expect.objectContaining({
            source: 'chat_upload',
            category: 'texto',
          }),
        }),
        'test-tenant'
      );
    });

    it('deve ignorar arquivos sem conteúdo extraído', async () => {
      const files = [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: '[Arquivo: test.txt]', // Placeholder
        },
      ];

      const results = await indexFilesInRag(files, 'test-tenant');

      expect(results).toHaveLength(0);
      expect(ragDocumentsService.createDocument).not.toHaveBeenCalled();
    });

    it('deve indexar múltiplos arquivos', async () => {
      ragDocumentsService.createDocument
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-1', title: 'file1.txt' },
        })
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-2', title: 'file2.txt' },
        });

      const files = [
        {
          name: 'file1.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo 1',
        },
        {
          name: 'file2.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo 2',
        },
      ];

      const results = await indexFilesInRag(files, 'test-tenant');

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(ragDocumentsService.createDocument).toHaveBeenCalledTimes(2);
    });

    it('deve tratar erros de indexação sem falhar', async () => {
      ragDocumentsService.createDocument.mockRejectedValue(
        new Error('Erro ao criar documento')
      );

      const files = [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo de teste',
        },
      ];

      const results = await indexFilesInRag(files, 'test-tenant');

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    it('deve usar opções personalizadas', async () => {
      ragDocumentsService.createDocument.mockResolvedValue({
        success: true,
        document: { id: 'doc-123', title: 'test.txt' },
      });

      const files = [
        {
          name: 'test.txt',
          type: 'text/plain',
          size: 100,
          content: 'Conteúdo de teste',
        },
      ];

      const options = {
        category: 'custom-category',
        metadata: {
          sessionId: 'session-123',
          flowId: 'flow-123',
        },
        autoIndex: true,
      };

      await indexFilesInRag(files, 'test-tenant', options);

      expect(ragDocumentsService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            category: 'custom-category',
            sessionId: 'session-123',
            flowId: 'flow-123',
          }),
        }),
        'test-tenant'
      );
    });

    it('deve retornar array vazio se não houver arquivos', async () => {
      const results = await indexFilesInRag([], 'test-tenant');

      expect(results).toHaveLength(0);
      expect(ragDocumentsService.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('getFileCategory', () => {
    it('deve retornar categoria correta para imagens', () => {
      expect(getFileCategory('image/png')).toBe('imagem');
      expect(getFileCategory('image/jpeg')).toBe('imagem');
    });

    it('deve retornar categoria correta para PDFs', () => {
      expect(getFileCategory('application/pdf')).toBe('documento');
    });

    it('deve retornar categoria correta para texto', () => {
      expect(getFileCategory('text/plain')).toBe('texto');
      expect(getFileCategory('text/html')).toBe('texto');
    });

    it('deve retornar "outro" para tipos desconhecidos', () => {
      expect(getFileCategory('application/octet-stream')).toBe('outro');
    });
  });
});

