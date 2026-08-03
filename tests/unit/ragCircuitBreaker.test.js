'use strict';

/**
 * Testes do circuit breaker + retry seletivo do rag-service
 * (api/services/rag/ragRuntime.js).
 */

const okResponse = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const httpResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({}),
  text: async () => `HTTP ${status}`,
});

// Mock do fetch global ANTES de carregar o módulo
global.fetch = jest.fn();

const {
  fetchRagWithBreaker,
  getRagCircuitBreakerState,
  isRagCircuitOpen,
  resetRagCircuitBreaker,
} = require('../../api/services/rag/ragRuntime');

describe('ragRuntime circuit breaker', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      RAG_CB_FAILURE_THRESHOLD: process.env.RAG_CB_FAILURE_THRESHOLD,
      RAG_CB_RESET_MS: process.env.RAG_CB_RESET_MS,
      RAG_CB_RETRY_BASE_MS: process.env.RAG_CB_RETRY_BASE_MS,
    };
    process.env.RAG_CB_FAILURE_THRESHOLD = '3';
    process.env.RAG_CB_RESET_MS = '30000';
    process.env.RAG_CB_RETRY_BASE_MS = '1'; // retries quase instantâneos no teste
    resetRagCircuitBreaker();
    fetch.mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetRagCircuitBreaker();
  });

  it('permanece fechado após sucessos', async () => {
    fetch.mockResolvedValue(okResponse({ status: 'healthy' }));

    const r1 = await fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000);
    const r2 = await fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getRagCircuitBreakerState().state).toBe('closed');
    expect(getRagCircuitBreakerState().consecutiveFailures).toBe(0);
    expect(isRagCircuitOpen()).toBe(false);
  });

  it('abre após N falhas consecutivas e rejeita imediato com code rag_unavailable', async () => {
    fetch.mockRejectedValue(new Error('fetch failed'));

    // 3 falhas consecutivas (não-idempotente: 1 tentativa por chamada)
    for (let i = 0; i < 3; i++) {
      await expect(fetchRagWithBreaker('http://rag/query', { method: 'POST' }, 1000))
        .rejects.toThrow('Falha ao conectar com serviço RAG');
    }

    expect(getRagCircuitBreakerState().state).toBe('open');
    expect(isRagCircuitOpen()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);

    // Circuito aberto: rejeita imediatamente, sem ir à rede
    await expect(fetchRagWithBreaker('http://rag/query', { method: 'POST' }, 1000))
      .rejects.toMatchObject({ code: 'rag_unavailable' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('abre com HTTP 5xx e meio-aberto fecha após probe com sucesso', async () => {
    process.env.RAG_CB_RESET_MS = '20';

    fetch.mockResolvedValue(httpResponse(500));
    for (let i = 0; i < 3; i++) {
      const res = await fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000);
      expect(res.status).toBe(500); // 5xx final é devolvido ao caller (não lançado)
    }
    expect(getRagCircuitBreakerState().state).toBe('open');

    // Imediatamente depois: ainda aberto
    await expect(fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000))
      .rejects.toMatchObject({ code: 'rag_unavailable' });

    // Após a janela de reset, probe em meio-aberto
    await new Promise((resolve) => setTimeout(resolve, 30));
    fetch.mockResolvedValueOnce(okResponse({ status: 'healthy' }));
    const probe = await fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000);

    expect(probe.status).toBe(200);
    expect(getRagCircuitBreakerState().state).toBe('closed');
    expect(getRagCircuitBreakerState().consecutiveFailures).toBe(0);
    expect(isRagCircuitOpen()).toBe(false);
  });

  it('reabre quando o probe do meio-aberto falha', async () => {
    process.env.RAG_CB_RESET_MS = '20';

    fetch.mockRejectedValue(new Error('fetch failed'));
    for (let i = 0; i < 3; i++) {
      await expect(fetchRagWithBreaker('http://rag/query', {}, 1000)).rejects.toThrow();
    }
    expect(getRagCircuitBreakerState().state).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 30));
    // Probe falha -> reabre
    await expect(fetchRagWithBreaker('http://rag/query', {}, 1000)).rejects.toThrow('Falha ao conectar com serviço RAG');
    expect(getRagCircuitBreakerState().state).toBe('open');

    // Continua rejeitando imediato dentro da nova janela
    const callsBefore = fetch.mock.calls.length;
    await expect(fetchRagWithBreaker('http://rag/query', {}, 1000))
      .rejects.toMatchObject({ code: 'rag_unavailable' });
    expect(fetch).toHaveBeenCalledTimes(callsBefore);
  });

  it('HTTP 4xx NÃO conta como falha', async () => {
    fetch.mockResolvedValue(httpResponse(400));

    for (let i = 0; i < 5; i++) {
      const res = await fetchRagWithBreaker('http://rag/query', { method: 'POST' }, 1000);
      expect(res.status).toBe(400);
    }

    expect(getRagCircuitBreakerState().state).toBe('closed');
    expect(getRagCircuitBreakerState().consecutiveFailures).toBe(0);
    expect(isRagCircuitOpen()).toBe(false);
  });

  it('retry com backoff acontece APENAS quando idempotent: true', async () => {
    fetch.mockRejectedValue(new Error('fetch failed'));

    // Não-idempotente: 1 tentativa, sem retry
    await expect(
      fetchRagWithBreaker('http://rag/query', { method: 'POST' }, 1000, { idempotent: false })
    ).rejects.toThrow('Falha ao conectar com serviço RAG');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Idempotente: 1 + 2 retries = 3 tentativas
    await expect(
      fetchRagWithBreaker('http://rag/documents', { method: 'GET' }, 1000, { idempotent: true })
    ).rejects.toThrow('Falha ao conectar com serviço RAG');
    expect(fetch).toHaveBeenCalledTimes(4);

    // Retries esgotados contam como UMA falha lógica (1 + 1 = 2 < threshold 3)
    expect(getRagCircuitBreakerState().consecutiveFailures).toBe(2);
    expect(getRagCircuitBreakerState().state).toBe('closed');
  });

  it('retry em idempotent também ocorre para HTTP 5xx e desiste após máx de retries', async () => {
    fetch.mockResolvedValue(httpResponse(503));

    const res = await fetchRagWithBreaker('http://rag/health', { method: 'GET' }, 1000, { idempotent: true });

    expect(res.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(getRagCircuitBreakerState().consecutiveFailures).toBe(1);
  });
});
