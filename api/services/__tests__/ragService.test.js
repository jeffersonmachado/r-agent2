/**
 * Testes do serviço RAG.
 */

// Mock do nlpService antes de carregar o módulo
jest.mock('../nlpService', () => ({
  analyzeText: jest.fn().mockResolvedValue({ expanded_query: null }),
}));

// Mock parcial da deduplicação: helpers puros reais; funções DB-backed stubadas
// com funções simples (jest.config usa resetMocks: true, que zeraria
// implementações de jest.fn()). A camada DB é coberta em
// tests/unit/ragDeduplicationService.coercion.test.js.
jest.mock('../ragDeduplicationService', () => {
  const actual = jest.requireActual('../ragDeduplicationService');
  return {
    ...actual,
    checkStructuralDuplicate: async () => ({ isDuplicate: false }),
    getCurrentSourceVersion: async () => 1,
    deactivatePreviousVersions: async () => undefined,
  };
});

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
const ragResponseCache = require('../rag/ragResponseCache');
const nlpService = require('../nlpService'); // mockado acima
const { resetRagCircuitBreaker } = require('../rag/ragRuntime');

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
    // Isolamento entre testes: cache de respostas e circuit breaker são
    // estado em nível de módulo.
    ragResponseCache.clearResponseCache();
    resetRagCircuitBreaker();
    nlpService.analyzeText.mockResolvedValue({ expanded_query: null });
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

  describe('getRagHealth (tri-estado)', () => {
    it('preserva degraded + causa do /rag/health (não colapsa em indisponível)', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'degraded',
          ready: false,
          reason: 'database_not_configured',
          dbConfigured: false,
        }),
      });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('degraded');
      expect(health.available).toBe(false);
      expect(health.reason).toBe('database_not_configured');
      expect(health.payload.dbConfigured).toBe(false);
      expect(health.httpStatus).toBe(200);
    });

    it('readiness negada vence status healthy (nunca verde sem ready)', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy', ready: false, reason: 'db_unreachable' }),
      });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('degraded');
      expect(health.available).toBe(false);
      expect(health.reason).toBe('db_unreachable');
    });

    it('healthy com ready=true é o único estado disponível', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy', ready: true, dbConfigured: true }),
      });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('healthy');
      expect(health.available).toBe(true);
      expect(health.ready).toBe(true);
      expect(health.reason).toBeNull();
    });

    it('HTTP != 2xx é unhealthy com o status medido', async () => {
      fetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('unhealthy');
      expect(health.errorType).toBe('http_error');
      expect(health.httpStatus).toBe(503);
    });

    it('HTTP 503 com corpo do serviço expõe a causa (service_misconfigured)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'service_misconfigured', message: 'Autenticação interna do RAG não configurada' }),
      });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('unhealthy');
      expect(health.httpStatus).toBe(503);
      expect(health.reason).toBe('service_misconfigured');
      expect(health.payload.message).toContain('Autenticação interna');
    });

    it('corpo não-JSON nunca é tratado como verde', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid json'); },
      });

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('degraded');
      expect(health.available).toBe(false);
    });

    it('falha de transporte é unhealthy classificada', async () => {
      fetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8001'));

      const health = await ragService.getRagHealth();

      expect(health.state).toBe('unhealthy');
      expect(health.errorType).toBe('connection_refused');
    });

    it('isRagAvailable segue booleano: false quando degradado', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'degraded', ready: false }),
      });

      await expect(ragService.isRagAvailable()).resolves.toBe(false);
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

    it('ignora ACL forjada quando não há identidade autenticada', async () => {
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

      expect(body.filters.roles).toEqual([]);
      expect(body.filters.agentId).toBeNull();
      expect(body.options.topK).toBe(10);
      expect(body.options.minScore).toBe(0.7);
    });

    it('deriva classificação e ACL da identidade autenticada', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, response: 'Resposta', sources: [], confidence: 0.7 }),
        text: async () => '{}',
        status: 200,
      });

      await ragService.queryRag(
        'Como investigar este incidente?',
        'tenant-001',
        // SUPPORT exige platform role concedido server-side (2026-08-27);
        // tenant role auditor puro é PRODUCTION.
        { actor: { id: 'auditor-1', role: 'auditor', platformRole: 'support_n2' } },
        { roles: ['forjada'], agentId: 'forjado' }
      );

      const callArgs = fetch.mock.calls[fetch.mock.calls.length - 1];
      const body = JSON.parse(callArgs[1].body);
      expect(body.scope.classifications).toEqual(['PRODUCTION', 'SUPPORT']);
      expect(body.filters.roles).toEqual(['auditor']);
      expect(body.filters.agentId).toBe('auditor-1');
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

  describe('generateEmbeddingsBatch', () => {
    let originalToken;

    beforeEach(() => {
      originalToken = process.env.RAG_INTERNAL_TOKEN;
    });

    afterEach(() => {
      if (originalToken === undefined) {
        delete process.env.RAG_INTERNAL_TOKEN;
      } else {
        process.env.RAG_INTERNAL_TOKEN = originalToken;
      }
    });

    it('deve enviar header interno quando RAG_INTERNAL_TOKEN está configurado', async () => {
      process.env.RAG_INTERNAL_TOKEN = 'token-teste-com-pelo-menos-32-bytes';

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, embeddings: [[0.1, 0.2]], model: 'm', dimensions: 2 }),
        text: async () => '',
        status: 200,
      });

      const result = await ragService.generateEmbeddingsBatch(['texto de teste'], 'tenant-001');

      expect(result.success).toBe(true);
      const callArgs = fetch.mock.calls[fetch.mock.calls.length - 1];
      expect(callArgs[0]).toBe('http://localhost:9000/rag/embeddings');
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');
      expect(callArgs[1].headers['X-RAG-Internal-Token']).toBe('token-teste-com-pelo-menos-32-bytes');
    });

    it('deve falhar fechado quando RAG_INTERNAL_TOKEN não está configurado', async () => {
      delete process.env.RAG_INTERNAL_TOKEN;

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, embeddings: [[0.1, 0.2]], model: 'm', dimensions: 2 }),
        text: async () => '',
        status: 200,
      });

      await expect(ragService.generateEmbeddingsBatch(['texto de teste'], 'tenant-001'))
        .rejects.toMatchObject({ code: 'rag_internal_auth_misconfigured' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('deve rejeitar RAG_INTERNAL_TOKEN curto ou placeholder', async () => {
      process.env.RAG_INTERNAL_TOKEN = 'token-curto';

      await expect(ragService.generateEmbeddingsBatch(['texto de teste'], 'tenant-001'))
        .rejects.toMatchObject({ code: 'rag_internal_auth_misconfigured' });
      expect(fetch).not.toHaveBeenCalled();
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
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-RAG-Internal-Token': expect.any(String),
          }),
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

  describe('queryRag — cache de resposta e gating por intent', () => {
    const successPayload = (response = 'Resposta gerada pelo RAG') => ({
      success: true,
      response,
      sources: [],
      confidence: 0.9,
      metadata: { chunksFound: 1 },
    });

    const mockRagSuccess = (payload = successPayload()) =>
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
        status: 200,
      });

    it('hit de cache não chama fetch novamente (poupa /rag/query)', async () => {
      mockRagSuccess();

      const first = await ragService.queryRag('pergunta cacheável', 'tenant-cache');
      expect(first.success).toBe(true);
      expect(first.fromCache).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Mesma pergunta com case/whitespace diferentes → mesma chave
      const second = await ragService.queryRag('  PERGUNTA   Cacheável ', 'tenant-cache');
      expect(second.success).toBe(true);
      expect(second.fromCache).toBe(true);
      expect(second.response).toBe('Resposta gerada pelo RAG');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('cópia marcada do cache não muta a entrada cacheada', async () => {
      mockRagSuccess(successPayload('Original'));
      await ragService.queryRag('pergunta mutação', 'tenant-cache');

      const hit = await ragService.queryRag('pergunta mutação', 'tenant-cache');
      expect(hit.fromCache).toBe(true);
      hit.response = 'MUTADO';

      const hitAgain = await ragService.queryRag('pergunta mutação', 'tenant-cache');
      expect(hitAgain.response).toBe('Original');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('não cacheia erro: próxima chamada vai ao serviço de novo', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(
        ragService.queryRag('pergunta com erro', 'tenant-cache')
      ).rejects.toThrow('Erro interno no serviço RAG');
      expect(fetch).toHaveBeenCalledTimes(1);

      mockRagSuccess(successPayload('Recuperou'));
      const result = await ragService.queryRag('pergunta com erro', 'tenant-cache');
      expect(result.success).toBe(true);
      expect(result.fromCache).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('intent de saudação não chama /rag/query e retorna shape de skip', async () => {
      nlpService.analyzeText.mockResolvedValueOnce({
        intent: 'greeting',
        confidence: 0.3,
        expanded_query: null,
      });

      const result = await ragService.queryRag('Olá, bom dia!', 'tenant-gate');

      expect(result).toMatchObject({
        success: true,
        skipped: true,
        reason: 'intent_gated',
        intent: 'greeting',
        response: null,
        sources: [],
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('intent de despedida também é gated; demais intents seguem para /rag/query', async () => {
      nlpService.analyzeText.mockResolvedValueOnce({
        intent: 'goodbye',
        confidence: 0.6,
        expanded_query: null,
      });
      const bye = await ragService.queryRag('tchau, obrigado', 'tenant-gate');
      expect(bye.skipped).toBe(true);
      expect(fetch).not.toHaveBeenCalled();

      nlpService.analyzeText.mockResolvedValueOnce({
        intent: 'question',
        confidence: 0.9,
        expanded_query: null,
      });
      mockRagSuccess();
      const question = await ragService.queryRag('Como resetar senha?', 'tenant-gate');
      expect(question.skipped).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('confidence abaixo do mínimo configurado não faz skip', async () => {
      process.env.RAG_SKIP_INTENT_MIN_CONFIDENCE = '0.5';
      try {
        nlpService.analyzeText.mockResolvedValueOnce({
          intent: 'greeting',
          confidence: 0.3,
          expanded_query: null,
        });
        mockRagSuccess();

        const result = await ragService.queryRag('olá', 'tenant-gate');
        expect(result.skipped).toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        delete process.env.RAG_SKIP_INTENT_MIN_CONFIDENCE;
      }
    });

    it('lista de skip é configurável via RAG_SKIP_INTENTS (CSV)', async () => {
      process.env.RAG_SKIP_INTENTS = 'question';
      try {
        nlpService.analyzeText.mockResolvedValueOnce({
          intent: 'question',
          confidence: 0.9,
          expanded_query: null,
        });

        const result = await ragService.queryRag('Como faço X?', 'tenant-gate');
        expect(result.skipped).toBe(true);
        expect(result.intent).toBe('question');
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        delete process.env.RAG_SKIP_INTENTS;
      }
    });

    it('resposta skipped não entra no cache de respostas', async () => {
      nlpService.analyzeText.mockResolvedValue({
        intent: 'greeting',
        confidence: 0.9,
        expanded_query: null,
      });

      await ragService.queryRag('oi', 'tenant-gate');
      const second = await ragService.queryRag('oi', 'tenant-gate');

      expect(second.skipped).toBe(true);
      expect(second.fromCache).toBeUndefined();
      // Sem cache: o analyze foi consultado nas 2 chamadas
      expect(nlpService.analyzeText).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
