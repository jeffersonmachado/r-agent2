'use strict';

/**
 * Tri-estado da saúde do RAG (defeito medido em 2026-10-09).
 *
 * `rag-service/api/routes/health.py` publica três situações em `/rag/health`:
 *  - `healthy`   → liveness + readiness OK;
 *  - `degraded`  → processo no ar (HTTP 200) mas readiness negada, hoje o caso
 *                  `reason: 'database_not_configured'` / `dbConfigured: false`;
 *  - ausência/erro → inacessível ou HTTP != 2xx.
 *
 * O adapter Node colapsava tudo em `status === 'healthy'`, então o painel /dev
 * exibia "Serviço RAG não disponível" (unhealthy/vermelho) para um serviço
 * apenas degradado — escondendo a causa real do operador.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key, fallback) => fallback),
}));

jest.mock('../../infra/redis/rateLimitClient', () => ({
  isRedisAvailable: jest.fn(),
  getRateLimitClient: jest.fn(),
}));

jest.mock('../../api/services/ragService', () => ({
  getRagHealth: jest.fn(),
  getRagServiceUrl: jest.fn(),
}));

jest.mock('../../api/services/websocketService', () => ({
  getWebSocketServer: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => null),
}));

jest.mock('../../api/db/models', () => ({
  RagDocument: { count: jest.fn() },
}));

const { getRagHealth, getRagServiceUrl } = require('../../api/services/ragService');
const { getSequelize } = require('../../api/db/sequelize');
const { RagDocument } = require('../../api/db/models');
const {
  checkRagServiceStatus,
  checkServicesStatus,
} = require('../../api/services/systemStatusService');

const RAG_URL = 'http://127.0.0.1:8001';

function healthyHealth(payloadOverrides = {}) {
  const payload = {
    status: 'healthy',
    ready: true,
    dbConfigured: true,
    vectorStore: 'postgres',
    embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
    indexedDocuments: 3158,
    indexedChunks: 8460,
    ...payloadOverrides,
  };
  return {
    state: 'healthy',
    available: true,
    ready: true,
    reason: null,
    errorType: null,
    httpStatus: 200,
    payload,
    serviceUrl: RAG_URL,
  };
}

function degradedHealth(payloadOverrides = {}) {
  const payload = {
    status: 'degraded',
    ready: false,
    reason: 'database_not_configured',
    dbConfigured: false,
    vectorStore: 'postgres',
    embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
    ...payloadOverrides,
  };
  return {
    state: 'degraded',
    available: false,
    ready: false,
    reason: payload.reason,
    errorType: null,
    httpStatus: 200,
    payload,
    serviceUrl: RAG_URL,
  };
}

function unhealthyHealth(errorType, extra = {}) {
  return {
    state: 'unhealthy',
    available: false,
    ready: false,
    reason: errorType,
    errorType,
    payload: null,
    serviceUrl: RAG_URL,
    ...extra,
  };
}

describe('checkRagServiceStatus — tri-estado', () => {
  beforeEach(() => {
    getRagHealth.mockReset();
    getRagServiceUrl.mockReset();
    getRagServiceUrl.mockReturnValue(RAG_URL);
    getSequelize.mockReturnValue(null);
    RagDocument.count.mockReset();

    // O ramo unhealthy faz um probe de reforço via fetch nativo: determinizar
    // como falha de transporte para o teste não depender de um rag-service vivo.
    global.fetch = jest.fn(() => Promise.reject(new Error('fetch failed (ECONNREFUSED)')));
  });

  test('degraded (readiness negada) NÃO é reportado como unhealthy', async () => {
    getRagHealth.mockResolvedValue(degradedHealth());

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('degraded');
    expect(out.error).toContain('database_not_configured');
    expect(out.details.ready).toBe(false);
    expect(out.details.reason).toBe('database_not_configured');
    expect(out.details.dbConfigured).toBe(false);
    expect(out.details.port).toBe(8001);
    expect(out.details.hint).toContain('--env-file .env');
  });

  test('degraded genérico (sem dbConfigured) mantém a causa e um hint neutro', async () => {
    getRagHealth.mockResolvedValue(degradedHealth({ reason: 'vector_store_unavailable', dbConfigured: true }));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('degraded');
    expect(out.details.reason).toBe('vector_store_unavailable');
    expect(out.details.hint).toContain('/rag/health');
  });

  test('healthy sem banco acessível para as contagens continua healthy', async () => {
    getRagHealth.mockResolvedValue(healthyHealth());

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('healthy');
    expect(out.details.port).toBe(8001);
    expect(out.details.consistency).toBeNull();
  });

  test('connection_refused → unhealthy com a causa medida', async () => {
    getRagHealth.mockResolvedValue(unhealthyHealth('connection_refused'));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('Conexão recusada - serviço RAG não está rodando');
    expect(out.details.errorType).toBe('connection_refused');
  });

  test('timeout → unhealthy com a mensagem canônica', async () => {
    getRagHealth.mockResolvedValue(unhealthyHealth('timeout'));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('Timeout ao conectar com serviço RAG');
  });

  test('http_error → unhealthy reportando o status HTTP medido', async () => {
    getRagHealth.mockResolvedValue(unhealthyHealth('http_error', { httpStatus: 503 }));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('Serviço RAG retornou status HTTP 503');
    expect(out.details.httpStatus).toBe(503);
  });

  test('circuit_breaker_open → unhealthy nomeando o circuito aberto', async () => {
    getRagHealth.mockResolvedValue(unhealthyHealth('circuit_breaker_open'));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('Circuito aberto para o serviço RAG (falhas recentes)');
  });

  test('http_error com corpo do rag-service expõe a causa (503 service_misconfigured)', async () => {
    getRagHealth.mockResolvedValue(unhealthyHealth('http_error', {
      httpStatus: 503,
      reason: 'service_misconfigured',
      payload: { error: 'service_misconfigured', message: 'Autenticação interna do RAG não configurada' },
    }));

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('Serviço RAG retornou status HTTP 503 (service_misconfigured: Autenticação interna do RAG não configurada)');
    expect(out.details.reason).toBe('service_misconfigured');
    expect(out.details.message).toBe('Autenticação interna do RAG não configurada');
  });

  test('índice com documentos inconsistentes → degraded com indexHealth', async () => {
    getRagHealth.mockResolvedValue(healthyHealth());
    getSequelize.mockReturnValue({
      query: jest.fn().mockResolvedValue([[{ chunks: 10, docs: 3 }]]),
    });
    RagDocument.count.mockImplementation(async (arg) => {
      const where = arg?.where || {};
      if (where.index_status === 'indexed') return 3;
      if (where.inconsistent === true) return 1;
      if (where.index_status === 'failed') return 5;
      return 47;
    });

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('degraded');
    expect(out.error).toContain('Inconsistência RAG detectada');
    expect(out.details.indexHealth).toEqual({ total: 47, indexed: 3, failed: 5, inconsistent: 1 });
    expect(out.details.consistency.status).toBe('warning');
  });

  test('índice coerente (sem drift) permanece healthy mesmo com failed declarados', async () => {
    getRagHealth.mockResolvedValue(healthyHealth());
    getSequelize.mockReturnValue({
      query: jest.fn().mockResolvedValue([[{ chunks: 10, docs: 3 }]]),
    });
    RagDocument.count.mockImplementation(async (arg) => {
      const where = arg?.where || {};
      if (where.index_status === 'indexed') return 3;
      if (where.inconsistent === true) return 0;
      if (where.index_status === 'failed') return 2;
      return 47;
    });

    const out = await checkRagServiceStatus();

    expect(out.status).toBe('healthy');
    expect(out.details.indexHealth).toEqual({ total: 47, indexed: 3, failed: 2, inconsistent: 0 });
    expect(out.details.consistency.status).toBe('ok');
  });

  test('checkServicesStatus propaga o degraded do RAG para o status geral', async () => {
    getRagHealth.mockResolvedValue(degradedHealth());

    const out = await checkServicesStatus();

    expect(out.services.ragService.status).toBe('degraded');
    expect(out.overall.status).toBe('degraded');
    expect(out.overall.percentage).toBeLessThan(100);
  });
});
