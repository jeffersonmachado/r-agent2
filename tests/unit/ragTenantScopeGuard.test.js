'use strict';

/**
 * Regressão: rotas RAG aceitavam tenantId arbitrário (body/query/path) sem cruzar
 * com o tenant autenticado, permitindo leitura/mutação cross-tenant por qualquer
 * usuário com permissão rag:*. A regra correta: tenant solicitado deve ser o tenant
 * do ator, salvo super-admin.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { handleRagQueryRoutes } = require('../../api/modules/rag-documents/rag/ragQueryRoutes');
const { handleRagOperationsRoutes } = require('../../api/modules/rag-documents/rag/ragOperationsRoutes');
const { handleRagLearningRoutes } = require('../../api/modules/rag-documents/rag/ragLearningRoutes');
const { handleRagCoreRoutes } = require('../../api/modules/rag-documents/rag/ragCoreRoutes');

function makeRes() {
  return { status: null, body: null };
}

function makeDeps({ body = {}, isSuperAdmin = false, ragService = {}, ragDocumentsService = {} } = {}) {
  const res = makeRes();
  const deps = {
    requireAuth: jest.fn((req) => {
      req.agent = req.agent || { id: 'a1', username: 'op', tenantId: 'tenantA', role: 'operator' };
      req.tenantId = req.tenantId || req.agent.tenantId;
      return { valid: true, agent: req.agent };
    }),
    requirePermission: jest.fn(() => ({ allowed: true })),
    isSuperAdmin: jest.fn(() => isSuperAdmin),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => body),
    sendJson: jest.fn((targetRes, status, payload) => {
      targetRes.status = status;
      targetRes.body = payload;
    }),
    badRequest: jest.fn((targetRes, message) => {
      targetRes.status = 400;
      targetRes.body = { error: 'bad_request', message };
    }),
    setCorsHeaders: jest.fn(),
    logAction: jest.fn(),
    requireTenant: jest.fn((req) => req.tenantId || req.agent?.tenantId || null),
    ragService: {
      queryRag: jest.fn(async () => ({ answer: 'ok' })),
      getRagDomains: jest.fn(() => ({ chatbot: {}, rpa: {} })),
      isRagDomainEnabled: jest.fn(() => true),
      getRagDomainSources: jest.fn(() => []),
      getLearningMetrics: jest.fn(async () => ({})),
      updateSynonym: jest.fn(async () => ({})),
      updateSynonymsFromDocuments: jest.fn(async () => ({})),
      triggerLearning: jest.fn(async () => ({})),
      getFullLearningData: jest.fn(async () => ({})),
      deleteSynonym: jest.fn(async () => ({})),
      cleanInvalidQueries: jest.fn(async () => ({})),
      getRagServiceUrl: jest.fn(() => 'http://localhost:8001'),
      getRagTimeout: jest.fn(() => 1000),
      ...ragService,
    },
    ragDocumentsService: {
      getRagHealth: jest.fn(async () => ({ status: 'healthy' })),
      reindexAllTenant: jest.fn(async () => ({})),
      ...ragDocumentsService,
    },
    reindexAllNotIndexed: jest.fn(async () => ({})),
    reindexDocument: jest.fn(async () => ({ success: true })),
    ragDeduplicationService: { getDeduplicationStats: jest.fn(() => ({})) },
  };
  return { deps, res };
}

function makeReq({ method, url, tenantId = 'tenantA' }) {
  return {
    method,
    url,
    tenantId,
    agent: { id: 'a1', username: 'op', tenantId, role: 'operator' },
    headers: { 'content-type': 'application/json', 'content-length': '10' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

describe('RAG tenant scope guard — usuário operacional (não super-admin)', () => {
  test('POST /rag/query com tenantId de outro tenant é negado (403)', async () => {
    const { deps, res } = makeDeps({ body: { query: 'horário de atendimento', tenantId: 'tenantB' } });
    const handled = await handleRagQueryRoutes({ req: makeReq({ method: 'POST', url: '/rag/query' }), res, method: 'POST', pathname: '/rag/query', deps });
    expect(handled).toBe(true);
    expect(res.status).toBe(403);
    expect(deps.ragService.queryRag).not.toHaveBeenCalled();
  });

  test('POST /rag/query com tenantId do próprio tenant é permitido', async () => {
    const { deps, res } = makeDeps({ body: { query: 'horário', tenantId: 'tenantA' } });
    await handleRagQueryRoutes({ req: makeReq({ method: 'POST', url: '/rag/query' }), res, method: 'POST', pathname: '/rag/query', deps });
    expect(res.status).toBe(200);
    expect(deps.ragService.queryRag).toHaveBeenCalledWith('horário', 'tenantA', expect.anything(), expect.anything());
  });

  test('GET /rag/health?tenantId=outro é negado', async () => {
    const { deps, res } = makeDeps();
    await handleRagOperationsRoutes({ req: makeReq({ method: 'GET', url: '/rag/health?tenantId=tenantB' }), res, method: 'GET', pathname: '/rag/health', deps });
    expect(res.status).toBe(403);
    expect(deps.ragDocumentsService.getRagHealth).not.toHaveBeenCalled();
  });

  test('GET /rag/domains?tenantId=outro é negado', async () => {
    const { deps, res } = makeDeps();
    const handled = await handleRagCoreRoutes({ req: makeReq({ method: 'GET', url: '/rag/domains?tenantId=tenantB' }), res, method: 'GET', pathname: '/rag/domains', deps });
    expect(handled).toBe(true);
    expect(res.status).toBe(403);
  });

  test('GET /rag/learning/metrics/:outroTenant é negado', async () => {
    const { deps, res } = makeDeps();
    await handleRagLearningRoutes({ req: makeReq({ method: 'GET', url: '/rag/learning/metrics/tenantB' }), res, method: 'GET', pathname: '/rag/learning/metrics/tenantB', deps });
    expect(res.status).toBe(403);
    expect(deps.ragService.getLearningMetrics).not.toHaveBeenCalled();
  });

  test('PUT /rag/learning/synonyms com tenant_id de outro tenant é negado', async () => {
    const { deps, res } = makeDeps({ body: { tenant_id: 'tenantB', term: 'x', synonyms: ['y'] } });
    await handleRagLearningRoutes({ req: makeReq({ method: 'PUT', url: '/rag/learning/synonyms' }), res, method: 'PUT', pathname: '/rag/learning/synonyms', deps });
    expect(res.status).toBe(403);
    expect(deps.ragService.updateSynonym).not.toHaveBeenCalled();
  });

  test('POST /rag/learning/trigger-learning/:outroTenant é negado', async () => {
    const { deps, res } = makeDeps();
    await handleRagLearningRoutes({ req: makeReq({ method: 'POST', url: '/rag/learning/trigger-learning/tenantB' }), res, method: 'POST', pathname: '/rag/learning/trigger-learning/tenantB', deps });
    expect(res.status).toBe(403);
    expect(deps.ragService.triggerLearning).not.toHaveBeenCalled();
  });

  test('POST /rag/documents/reindex-all com tenantId de outro tenant é negado', async () => {
    const { deps, res } = makeDeps({ body: { tenantId: 'tenantB' } });
    await handleRagOperationsRoutes({ req: makeReq({ method: 'POST', url: '/rag/documents/reindex-all' }), res, method: 'POST', pathname: '/rag/documents/reindex-all', deps });
    expect(res.status).toBe(403);
    expect(deps.reindexAllNotIndexed).not.toHaveBeenCalled();
  });
});

describe('RAG tenant scope guard — super-admin', () => {
  test('POST /rag/query com tenantId de outro tenant é permitido para super-admin', async () => {
    const { deps, res } = makeDeps({ body: { query: 'horário', tenantId: 'tenantB' }, isSuperAdmin: true });
    await handleRagQueryRoutes({ req: makeReq({ method: 'POST', url: '/rag/query', tenantId: 'system' }), res, method: 'POST', pathname: '/rag/query', deps });
    expect(res.status).toBe(200);
    expect(deps.ragService.queryRag).toHaveBeenCalledWith('horário', 'tenantB', expect.anything(), expect.anything());
  });

  test('GET /rag/learning/metrics/:outroTenant é permitido para super-admin', async () => {
    const { deps, res } = makeDeps({ isSuperAdmin: true });
    await handleRagLearningRoutes({ req: makeReq({ method: 'GET', url: '/rag/learning/metrics/tenantB', tenantId: 'system' }), res, method: 'GET', pathname: '/rag/learning/metrics/tenantB', deps });
    expect(res.status).toBe(200);
    expect(deps.ragService.getLearningMetrics).toHaveBeenCalledWith('tenantB');
  });
});
