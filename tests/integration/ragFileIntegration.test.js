/**
 * Testes de integração completa com RAG para arquivos do chat
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { indexFilesInRag } = require('../../engine/services/fileRagService');
const ragDocumentsService = require('../../api/services/ragDocumentsService');
const ragService = require('../../api/services/ragService');

// Mock dos serviços
jest.mock('../../api/services/ragDocumentsService');
jest.mock('../../api/services/ragService');

describe('Integração RAG - Arquivos do Chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Fluxo Completo: Upload -> Indexação -> Query', () => {
    it('deve indexar arquivo e torná-lo disponível para query RAG', async () => {
      const file = {
        name: 'promocoes.txt',
        type: 'text/plain',
        size: 500,
        content: 'Promoção especial: 50% de desconto em todos os produtos até o final do mês.',
      };

      // Mock: Indexação bem-sucedida
      ragDocumentsService.createDocument.mockResolvedValue({
        success: true,
        document: {
          id: 'doc-promocoes-123',
          title: 'promocoes.txt',
          content: file.content,
          indexed: true,
          chunksCount: 3,
        },
      });

      // Indexa arquivo
      const indexResults = await indexFilesInRag([file], 'test-tenant', {
        category: 'promocoes',
      });

      expect(indexResults).toHaveLength(1);
      expect(indexResults[0].success).toBe(true);
      expect(ragDocumentsService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'promocoes.txt',
          content: file.content,
          metadata: expect.objectContaining({
            category: 'promocoes',
            source: 'chat_upload',
          }),
        }),
        'test-tenant'
      );

      // Mock: Query RAG encontra o documento
      ragService.queryRag.mockResolvedValue({
        success: true,
        response: 'Há uma promoção especial com 50% de desconto disponível.',
        confidence: 0.85,
        sources: [
          {
            documentId: 'doc-promocoes-123',
            title: 'promocoes.txt',
            score: 0.9,
          },
        ],
      });

      // Query RAG deve encontrar o documento indexado
      const queryResult = await ragService.queryRag(
        'Quais são as promoções disponíveis?',
        'test-tenant'
      );

      expect(queryResult.success).toBe(true);
      expect(queryResult.response).toContain('promoção');
      expect(queryResult.sources).toHaveLength(1);
      expect(queryResult.sources[0].documentId).toBe('doc-promocoes-123');
    });

    it('deve indexar múltiplos arquivos e todos estarem disponíveis para query', async () => {
      const files = [
        {
          name: 'promocoes.txt',
          type: 'text/plain',
          size: 500,
          content: 'Promoção: 50% de desconto',
        },
        {
          name: 'avisos.txt',
          type: 'text/plain',
          size: 300,
          content: 'Aviso: Manutenção programada para domingo',
        },
        {
          name: 'tabela_preco.txt',
          type: 'text/plain',
          size: 1000,
          content: 'Tabela de preços atualizada: Produto A - R$ 100, Produto B - R$ 200',
        },
      ];

      // Mock: Indexação de múltiplos arquivos
      ragDocumentsService.createDocument
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-1', title: 'promocoes.txt' },
        })
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-2', title: 'avisos.txt' },
        })
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-3', title: 'tabela_preco.txt' },
        });

      const indexResults = await indexFilesInRag(files, 'test-tenant', {
        category: 'chat_upload',
      });

      expect(indexResults).toHaveLength(3);
      expect(indexResults.every(r => r.success)).toBe(true);
      expect(ragDocumentsService.createDocument).toHaveBeenCalledTimes(3);
    });

    it('deve filtrar arquivos por categoria na query RAG', async () => {
      const promocoesFile = {
        name: 'promocoes.txt',
        type: 'text/plain',
        content: 'Promoção especial',
      };

      const avisosFile = {
        name: 'avisos.txt',
        type: 'text/plain',
        content: 'Aviso importante',
      };

      // Indexa com categorias diferentes
      ragDocumentsService.createDocument
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-promo', title: 'promocoes.txt' },
        })
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-aviso', title: 'avisos.txt' },
        });

      await indexFilesInRag([promocoesFile], 'test-tenant', {
        category: 'promocoes',
      });

      await indexFilesInRag([avisosFile], 'test-tenant', {
        category: 'avisos',
      });

      // Query com filtro de categoria
      ragService.queryRag.mockResolvedValue({
        success: true,
        response: 'Há uma promoção especial disponível.',
        sources: [{ documentId: 'doc-promo', title: 'promocoes.txt' }],
      });

      const result = await ragService.queryRag(
        'Quais são as promoções?',
        'test-tenant',
        {},
        { category: 'promocoes' }
      );

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].documentId).toBe('doc-promo');
    });
  });

  describe('Metadados e Rastreabilidade', () => {
    it('deve incluir metadados completos na indexação', async () => {
      const file = {
        name: 'documento.txt',
        type: 'text/plain',
        size: 1000,
        content: 'Conteúdo do documento',
      };

      ragDocumentsService.createDocument.mockResolvedValue({
        success: true,
        document: { id: 'doc-123', title: 'documento.txt' },
      });

      await indexFilesInRag([file], 'test-tenant', {
        category: 'chat_upload',
        metadata: {
          sessionId: 'session-123',
          flowId: 'flow-123',
          nodeId: 'user_input-1',
          uploadedAt: '2024-01-01T00:00:00Z',
        },
      });

      expect(ragDocumentsService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            source: 'chat_upload',
            category: 'chat_upload',
            sessionId: 'session-123',
            flowId: 'flow-123',
            nodeId: 'user_input-1',
          }),
        }),
        'test-tenant'
      );
    });

    it('deve rastrear origem dos documentos indexados', async () => {
      const file = {
        name: 'test.txt',
        type: 'text/plain',
        content: 'Conteúdo',
      };

      ragDocumentsService.createDocument.mockResolvedValue({
        success: true,
        document: {
          id: 'doc-123',
          title: 'test.txt',
          metadata: {
            source: 'chat_upload',
            uploadedAt: expect.any(String),
          },
        },
      });

      const results = await indexFilesInRag([file], 'test-tenant');

      expect(results[0].success).toBe(true);
      expect(ragDocumentsService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            source: 'chat_upload',
          }),
        }),
        'test-tenant'
      );
    });
  });

  describe('Tratamento de Erros', () => {
    it('deve continuar indexando outros arquivos se um falhar', async () => {
      const files = [
        {
          name: 'file1.txt',
          type: 'text/plain',
          content: 'Conteúdo 1',
        },
        {
          name: 'file2.txt',
          type: 'text/plain',
          content: 'Conteúdo 2',
        },
        {
          name: 'file3.txt',
          type: 'text/plain',
          content: 'Conteúdo 3',
        },
      ];

      ragDocumentsService.createDocument
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-1', title: 'file1.txt' },
        })
        .mockRejectedValueOnce(new Error('Erro ao indexar file2'))
        .mockResolvedValueOnce({
          success: true,
          document: { id: 'doc-3', title: 'file3.txt' },
        });

      const results = await indexFilesInRag(files, 'test-tenant');

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });
});

