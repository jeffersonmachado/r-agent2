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
  const runAskAiTurn = jest.fn(async () => ({
    conversationId: 'conv_abc123456789',
    answer: 'Use o fluxo de redefinição autorizado.',
    sources: [],
    facts: [],
    intent: 'KNOWLEDGE',
    confidence: 'fully_grounded',
    provenance: { liveData: [], knowledge: [], inference: 'none', recommendation: 'none' },
    policy: { entityValidated: true },
  }));
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
    runAskAiTurn,
    ...overrides,
  };
  return { req, res, deps, responses, runAskAiTurn };
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
  test('nega chamada anônima antes de orquestrar', async () => {
    const harness = buildHarness({
      requireAuth: jest.fn(() => ({ valid: false, error: 'token ausente' })),
    });

    await invoke(harness);

    expect(harness.responses[0].status).toBe(401);
    expect(harness.runAskAiTurn).not.toHaveBeenCalled();
  });

  test('exige permissão rag:query', async () => {
    const harness = buildHarness({
      requirePermission: jest.fn(() => ({ allowed: false, error: 'negada' })),
    });

    await invoke(harness);

    expect(harness.deps.requirePermission).toHaveBeenCalledWith(harness.req, 'rag', 'query');
    expect(harness.responses[0].status).toBe(403);
    expect(harness.runAskAiTurn).not.toHaveBeenCalled();
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

    expect(harness.runAskAiTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      actor: harness.req.agent,
      payload: expect.objectContaining({ question: 'Como redefino minha senha?' }),
    }));
    expect(harness.deps.logActionRequired).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      action: 'rag_query',
    }));
    expect(harness.responses[0]).toMatchObject({
      status: 200,
      body: { success: true, conversationId: 'conv_abc123456789', intent: 'KNOWLEDGE' },
    });
  });

  test('rejeita contexto de tela com campo desconhecido antes de orquestrar', async () => {
    const harness = buildHarness({
      parseJsonBody: jest.fn(async () => ({
        question: 'oi',
        context: { role: 'super_admin' },
      })),
    });

    await invoke(harness);

    expect(harness.responses[0].status).toBe(400);
    expect(harness.runAskAiTurn).not.toHaveBeenCalled();
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
    expect(harness.runAskAiTurn).not.toHaveBeenCalled();
  });

  test('persistência conversacional indisponível responde 503 explícito', async () => {
    const persistenceError = Object.assign(new Error('ask_ai_conversation_persistence_required'), {
      code: 'PERSISTENCE_REQUIRED',
    });
    const harness = buildHarness({
      runAskAiTurn: jest.fn(async () => { throw persistenceError; }),
    });

    await invoke(harness);

    expect(harness.responses[0]).toMatchObject({
      status: 503,
      body: { success: false, error: 'persistence_required' },
    });
  });

  test('conversa inexistente responde 404 sem vazar existência', async () => {
    const notFound = Object.assign(new Error('Conversa não encontrada'), { code: 'NOT_FOUND' });
    const harness = buildHarness({
      runAskAiTurn: jest.fn(async () => { throw notFound; }),
    });

    await invoke(harness);

    expect(harness.responses[0]).toMatchObject({
      status: 404,
      body: { success: false, error: 'conversation_not_found' },
    });
  });

  test('erro inesperado não vaza stack trace nem mensagem interna', async () => {
    const harness = buildHarness({
      runAskAiTurn: jest.fn(async () => { throw new Error('boom interno'); }),
    });

    await invoke(harness);

    expect(harness.responses[0].status).toBe(500);
    expect(JSON.stringify(harness.responses[0].body)).not.toContain('boom interno');
    expect(harness.responses[0].body).not.toHaveProperty('stack');
  });

  test('turno bloqueado (sem `policy`) responde 200 com a recusa, nunca 500', async () => {
    // Regressão: o orquestrador devolvia o turno bloqueado SEM `policy` e a
    // rota lia `turn.policy.entityValidated` — a recusa determinística de
    // internals técnicos por PRODUCTION virava HTTP 500.
    const harness = buildHarness({
      runAskAiTurn: jest.fn(async () => ({
        conversationId: 'conv_blocked0001',
        answer: 'Não posso responder sobre conteúdo técnico interno da plataforma.',
        sources: [],
        facts: [],
        intent: 'SYSTEM_INTERNAL',
        confidence: 'insufficient_evidence',
        provenance: { liveData: [], knowledge: [], inference: 'none', recommendation: 'none' },
        historyWindow: 2,
        blocked: true,
      })),
    });

    await invoke(harness);

    expect(harness.responses).toHaveLength(1);
    expect(harness.responses[0]).toMatchObject({
      status: 200,
      body: {
        success: true,
        intent: 'SYSTEM_INTERNAL',
        context: { entityValidated: false },
      },
    });
    expect(harness.responses[0].body.answer).toContain('Não posso responder');
  });
});
