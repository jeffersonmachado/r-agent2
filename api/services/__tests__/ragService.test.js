/**
 * Testes do serviço RAG.
 */

// Mock do nlpService antes de carregar o módulo
jest.mock('../nlpService', () => ({
  analyzeText: jest.fn().mockResolvedValue({ expanded_query: null }),
}));

// Mock do fetch global ANTES de carregar o módulo
let mockFetchResponse = {
  ok: true,
  json: async () => ({}),
  text: async () => '',
  status: 200,
};

global.fetch = jest.fn((url, options) => {
  // Retorna o mockFetchResponse atualizado
  return Promise.resolve(mockFetchResponse);
});

global.AbortController = jest.fn(() => {
  const controller = {
    abort: jest.fn(),
    signal: { aborted: false },
  };
  return controller;
});

const ragService = require('../ragService');

describe('ragService', () => {
  beforeEach(() => {
    fetch.mockClear();
    // Reset mock response to default
    mockFetchResponse = {
      ok: true,
      json: async () => ({}),
      text: async () => '',
      status: 200,
    };
    process.env.RAG_SERVICE_URL = 'http://localhost:9000';
    process.env.RAG_TIMEOUT = '5000';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isRagAvailable', () => {
    it('deve retornar true quando o serviço está disponível', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const result = await ragService.isRagAvailable();
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:9000/rag/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('deve retornar false quando o serviço não está disponível', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
      });

      const result = await ragService.isRagAvailable();
      expect(result).toBe(false);
    });

    it('deve retornar false quando há erro na requisição', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await ragService.isRagAvailable();
      expect(result).toBe(false);
    });

    it('deve retornar false quando o status não é healthy', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'unhealthy' }),
      });

      const result = await ragService.isRagAvailable();
      expect(result).toBe(false);
    });
  });

  describe('queryRag', () => {
    it('deve fazer consulta RAG com sucesso', async () => {
      const mockResponse = {
        success: true,
        response: 'Resposta gerada pelo RAG',
        sources: [
          {
            chunkId: 'chunk-001',
            documentId: 'doc-001',
            title: 'Chunk 1',
            score: 0.85,
            excerpt: 'Excerpt...',
          },
        ],
        confidence: 0.85,
        metadata: {
          chunksSearched: 5,
          chunksFound: 1,
        },
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        status: 200,
      });

      const result = await ragService.queryRag(
        'Como resetar minha senha?',
        'tenant-001'
      );

      expect(result.success).toBe(true);
      expect(result.response).toBe('Resposta gerada pelo RAG');
      expect(result.sources).toHaveLength(1);
      expect(result.confidence).toBe(0.85);
      expect(fetch).toHaveBeenCalled();
    });

    it('deve lançar erro quando query está vazia', async () => {
      await expect(
        ragService.queryRag('', 'tenant-001')
      ).rejects.toThrow('Query não pode ser vazia');
    });

    it('deve lançar erro quando query é apenas espaços', async () => {
      await expect(
        ragService.queryRag('   ', 'tenant-001')
      ).rejects.toThrow('Query não pode ser vazia');
    });

    it('deve lançar erro quando tenantId está ausente', async () => {
      await expect(
        ragService.queryRag('Qual é a resposta?', null)
      ).rejects.toThrow('tenantId é obrigatório');
    });

    it('deve enviar filtros corretamente', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          response: 'Resposta',
          sources: [],
          confidence: 0.5,
        }),
        text: async () => '{}',
        status: 200,
      });

      await ragService.queryRag('query', 'tenant-001', {}, {
        roles: ['admin'],
        agentId: 'agent-001',
        topK: 10,
        minScore: 0.7,
      });

      expect(fetch).toHaveBeenCalled();
      const callArgs = fetch.mock.calls[fetch.mock.calls.length - 1];
      const body = JSON.parse(callArgs[1].body);

      expect(body.filters.roles).toEqual(['admin']);
      expect(body.filters.agentId).toBe('agent-001');
      expect(body.options.topK).toBe(10);
      expect(body.options.minScore).toBe(0.7);
    });

    it('deve usar normalized_context para enriquecer query e preencher filtros padrão', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          response: 'Resposta',
          sources: [],
          confidence: 0.7,
        }),
        text: async () => '{}',
        status: 200,
      });

      await ragService.queryRag(
        'preciso de ajuda com meu pedido',
        'tenant-001',
        {
          normalized_context: {
            funnel_state: { intent: 'support', severity: 'high' },
            tags: ['topic:billing', 'intent:support'],
            entities: {
              product_or_plan: { value: 'plano_pro' },
              order_id: { value: 'ord-99' },
            },
          },
        },
        {}
      );

      const callArgs = fetch.mock.calls[fetch.mock.calls.length - 1];
      const body = JSON.parse(callArgs[1].body);

      expect(body.query).toContain('[Contexto normalizado:');
      expect(body.query).toContain('intent:support');
      expect(body.query).toContain('severity:high');
      expect(body.query).toContain('produto:plano_pro');
      expect(body.query).toContain('pedido:ord-99');
      expect(body.filters.productId).toBe('plano_pro');
      expect(body.filters.category).toBe('topic:billing');
    });

    it('deve tratar erro do serviço RAG', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(
        ragService.queryRag('query', 'tenant-001')
      ).rejects.toThrow('Erro interno no serviço RAG');
    });

    it('deve tratar timeout', async () => {
      // Simula timeout fazendo o fetch rejeitar com AbortError
      // O erro precisa ser lançado dentro do fetchWithTimeout
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      
      // Mock do fetch para rejeitar com AbortError
      fetch.mockImplementationOnce(async () => {
        throw abortError;
      });

      await expect(
        ragService.queryRag('query', 'tenant-001')
      ).rejects.toThrow('Timeout ao consultar serviço RAG');
    });
  });

  describe('indexDocument', () => {
    it('deve indexar documento com sucesso', async () => {
      const mockResponse = {
        success: true,
        documentId: 'doc-001',
        chunksCreated: 3,
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const document = {
        id: 'doc-001',
        title: 'Documento de Teste',
        content: 'Conteúdo do documento para indexação.',
        metadata: { category: 'test' },
      };

      const result = await ragService.indexDocument(document, 'tenant-001');

      expect(result.success).toBe(true);
      expect(result.documentId).toBe('doc-001');
      expect(result.chunksCreated).toBe(3);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:9000/rag/index',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('deve lançar erro quando documento não tem id', async () => {
      const document = {
        title: 'Sem ID',
        content: 'Conteúdo',
      };

      await expect(
        ragService.indexDocument(document, 'tenant-001')
      ).rejects.toThrow('Documento deve ter id');
    });

    it('deve lançar erro quando documento não tem content', async () => {
      const document = {
        id: 'doc-002',
        title: 'Sem conteúdo',
      };

      await expect(
        ragService.indexDocument(document, 'tenant-001')
      ).rejects.toThrow('Documento deve ter content');
    });

    it('deve lançar erro quando tenantId está ausente', async () => {
      const document = {
        id: 'doc-003',
        content: 'Conteúdo',
      };

      await expect(
        ragService.indexDocument(document, null)
      ).rejects.toThrow('tenantId é obrigatório');
    });

    it('deve enviar metadados e permissões corretamente', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          documentId: 'doc-004',
          chunksCreated: 1,
        }),
      }).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      });

      const document = {
        id: 'doc-004',
        title: 'Documento com Metadados',
        content: 'Conteúdo',
        metadata: {
          category: 'support',
          source: 'manual',
        },
        permissions: {
          roles: ['admin'],
        },
        status: 'active',
      };

      await ragService.indexDocument(document, 'tenant-001');

      const callArgs = fetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.document.id).toBe('doc-004');
      expect(body.document.metadata.category).toBe('support');
      expect(body.document.permissions.roles).toEqual(['admin']);
      expect(body.document.status).toBe('active');
    });

    it('deve usar timeout maior para indexação', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          documentId: 'doc-005',
          chunksCreated: 1,
        }),
      }).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      });

      const document = {
        id: 'doc-005',
        content: 'Conteúdo único para timeout',
      };

      await ragService.indexDocument(document, 'tenant-001');

      // Verifica que foi chamado (o timeout é interno, mas podemos verificar a chamada)
      expect(fetch).toHaveBeenCalled();
    });

    it('deve tratar erro do serviço RAG na indexação', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const document = {
        id: 'doc-006',
        content: 'Conteúdo único para erro 006',
      };

      await expect(
        ragService.indexDocument(document, 'tenant-001')
      ).rejects.toThrow('RAG service error: 400');
    });
  });
});

