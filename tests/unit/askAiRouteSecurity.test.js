'use strict';

const { handleAskAiRoute } = require('../../api/modules/platform-content/handleAskAiRoute');

function buildHarness(overrides = {}) {
  const responses = [];
  const res = {
    setHeader: jest.fn(),
  };
  const req = {
    agent: { id: 'agent-a', username: 'ana', tenantId: 'tenant-a', role: 'agent' },
    tenantId: 'tenant-a',
    headers: { 'user-agent': 'jest' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-a'),
    sendJson: jest.fn((_res, status, body) => responses.push({ status, body })),
    badRequest: jest.fn((_res, message) => responses.push({ status: 400, body: { message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ question: 'Como redefino minha senha?' })),
    checkRateLimit: jest.fn(async () => ({ allowed: true })),
    logActionRequired: jest.fn(async () => ({ persisted: true })),
    ragService: {
      queryRag: jest.fn(async () => ({
        success: true,
        response: 'Use o fluxo de redefinição autorizado.',
        sources: [],
        confidence: 0.9,
      })),
    },
    logger: { error: jest.fn() },
    ...overrides,
  };
  return { req, res, deps, responses };
}

async function invoke(harness) {
  return handleAskAiRoute({
    req: harness.req,
    res: harness.res,
    method: 'POST',
    pathname: '/api/ask-ai',
    deps: harness.deps,
  });
}

describe('POST /api/ask-ai — boundary de segurança', () => {
  test('nega chamada anônima antes de consultar o RAG', async () => {
    const harness = buildHarness({
      requireAuth: jest.fn(() => ({ valid: false, error: 'token ausente' })),
    });

    await invoke(harness);

    expect(harness.responses[0].status).toBe(401);
    expect(harness.deps.ragService.queryRag).not.toHaveBeenCalled();
  });

  test('exige permissão rag:query', async () => {
    const harness = buildHarness({
      requirePermission: jest.fn(() => ({ allowed: false, error: 'negada' })),
    });

    await invoke(harness);

    expect(harness.deps.requirePermission).toHaveBeenCalledWith(harness.req, 'rag', 'query');
    expect(harness.responses[0].status).toBe(403);
    expect(harness.deps.ragService.queryRag).not.toHaveBeenCalled();
  });

  test('aplica rate limit antes de processar a pergunta', async () => {
    const harness = buildHarness({
      checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 17 })),
    });

    await invoke(harness);

    expect(harness.responses[0].status).toBe(429);
    expect(harness.res.setHeader).toHaveBeenCalledWith('Retry-After', 17);
    expect(harness.deps.parseJsonBody).not.toHaveBeenCalled();
  });

  test('propaga identidade autenticada e audita com tenant', async () => {
    const harness = buildHarness();

    await invoke(harness);

    expect(harness.deps.ragService.queryRag).toHaveBeenCalledWith(
      'Como redefino minha senha?',
      'tenant-a',
      { actor: harness.req.agent },
      expect.objectContaining({ topK: 6 })
    );
    expect(harness.deps.logActionRequired).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      action: 'rag_query',
    }));
    expect(harness.responses[0]).toMatchObject({ status: 200, body: { success: true } });
  });

  test('falha fechada quando a auditoria durável está indisponível', async () => {
    const persistenceError = Object.assign(new Error('audit_persistence_required'), {
      code: 'PERSISTENCE_REQUIRED',
    });
    const harness = buildHarness({
      logActionRequired: jest.fn(async () => { throw persistenceError; }),
    });

    await invoke(harness);

    expect(harness.responses).toHaveLength(1);
    expect(harness.responses[0]).toMatchObject({
      status: 503,
      body: { success: false, error: 'persistence_required', answer: null },
    });
    expect(harness.deps.ragService.queryRag).not.toHaveBeenCalled();
  });

  test('resposta ausente do RAG nunca é normalizada como sucesso', async () => {
    const harness = buildHarness({
      ragService: { queryRag: jest.fn(async () => null) },
    });

    await invoke(harness);

    expect(harness.responses[0]).toMatchObject({
      status: 200,
      body: { success: false, confidence: null },
    });
  });
});
