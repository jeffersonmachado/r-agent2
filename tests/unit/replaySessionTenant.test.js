'use strict';

/**
 * Regressão: sessões de replay (sessionEvents) não eram isoladas por tenant.
 *
 * Falha observada (inspeção 2026-07-28): o Map `sessionEvents` é plano
 * (sessionId → eventos), sem carimbo de tenant. GET /replay/:sessionId e
 * GET /conversations/:sessionId exigiam apenas autenticação — qualquer
 * usuário autenticado de um tenant A podia ler os eventos de conversa de
 * uma sessão do tenant B bastando conhecer/adivinhar o sessionId
 * (cross-tenant object reference).
 *
 * Comportamento correto:
 * - writers carimbam o tenant da sessão no ato da escrita;
 * - readers respondem 404 (sem vazar existência) quando o tenant carimbado
 *   difere de req.tenantId;
 * - sessão sem carimbo é fail-closed (404) para qualquer chamador;
 * - super-admin sem X-Tenant-Id (req.tenantId === null) não lê nada.
 */

const {
  handleFlowExecutionRoutes,
} = require('../../api/modules/domain-flow/flow-execution/flowExecutionRoutes');
const {
  handleConversationRoutes,
} = require('../../api/modules/domain-flow/handleConversationRoutes');

function makeRes() {
  return { statusCode: null, body: null, writableEnded: false };
}

function makeDeps(overrides) {
  return {
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({ flowId: 'flow-1' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    requireAuth: (req) => {
      req.tenantId = req.headers['x-test-tenant'] || null;
      return { valid: true, agent: { id: 'u1' } };
    },
    requirePermission: () => ({ allowed: true }),
    sessionEvents: new Map([['sess-1', [{ type: 'message', text: 'oi' }]]]),
    sessionTenants: new Map([['sess-1', 'tenant-a']]),
    buildConversationReplay: (events) => ({ events }),
    validateFlow: () => ({ valid: true, errors: [] }),
    flows: new Map([['flow-1', { id: 'flow-1', tenantId: 'tenant-a', nodes: [{}] }]]),
    simulateFlow: async () => ({ replay: { sessionId: 'sess-9' }, events: [{ type: 'message', text: 'sim' }] }),
    saveSessionEventsToFile: () => {},
    ...overrides,
  };
}

function ctxFor(method, pathname, deps, tenant) {
  return {
    req: { headers: tenant ? { 'x-test-tenant': tenant } : {}, url: pathname },
    res: makeRes(),
    method,
    pathname,
    deps,
  };
}

describe('GET /replay/:sessionId — isolamento por tenant', () => {
  it('chamador do mesmo tenant lê o replay (200)', async () => {
    const ctx = ctxFor('GET', '/replay/sess-1', makeDeps(), 'tenant-a');
    await handleFlowExecutionRoutes(ctx);
    expect(ctx.res.statusCode).toBe(200);
  });

  it('chamador de OUTRO tenant recebe 404 (não vaza existência nem dados)', async () => {
    const ctx = ctxFor('GET', '/replay/sess-1', makeDeps(), 'tenant-b');
    await handleFlowExecutionRoutes(ctx);
    expect(ctx.res.statusCode).toBe(404);
    expect(ctx.res.body).toEqual(expect.objectContaining({ error: 'session_not_found' }));
  });

  it('super-admin sem X-Tenant-Id (req.tenantId null) recebe 404', async () => {
    const ctx = ctxFor('GET', '/replay/sess-1', makeDeps(), null);
    await handleFlowExecutionRoutes(ctx);
    expect(ctx.res.statusCode).toBe(404);
  });

  it('sessão sem carimbo de tenant é fail-closed (404) para qualquer chamador', async () => {
    const deps = makeDeps({ sessionTenants: new Map() });
    const ctx = ctxFor('GET', '/replay/sess-1', deps, 'tenant-a');
    await handleFlowExecutionRoutes(ctx);
    expect(ctx.res.statusCode).toBe(404);
  });
});

describe('POST /flows/simulate — carimba o tenant da sessão na escrita', () => {
  it('grava o tenantId do fluxo no registro de tenants da sessão', async () => {
    const deps = makeDeps({ sessionTenants: new Map() });
    const ctx = ctxFor('POST', '/flows/simulate', deps, 'tenant-a');
    await handleFlowExecutionRoutes(ctx);
    expect(ctx.res.statusCode).toBe(200);
    expect(deps.sessionTenants.get('sess-9')).toBe('tenant-a');
  });
});

describe('GET /conversations/:sessionId — isolamento por tenant', () => {
  it('chamador do mesmo tenant lê a conversa (200)', async () => {
    const ctx = ctxFor('GET', '/conversations/sess-1', makeDeps(), 'tenant-a');
    await handleConversationRoutes(ctx);
    expect(ctx.res.statusCode).toBe(200);
  });

  it('chamador de OUTRO tenant recebe 404 conversation_not_found', async () => {
    const ctx = ctxFor('GET', '/conversations/sess-1', makeDeps(), 'tenant-b');
    await handleConversationRoutes(ctx);
    expect(ctx.res.statusCode).toBe(404);
    expect(ctx.res.body).toEqual(expect.objectContaining({ error: 'conversation_not_found' }));
  });
});
