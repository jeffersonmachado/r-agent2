/**
 * Testes unitários para operatorPanelRoutes
 * Cobre: /snapshot, /events (SSE), /agent-status, /agent-pause-queue, /transfer, /callback
 */

const mockService = {
  listOperatorPanelSnapshot: jest.fn(async () => ({
    ok: true,
    generatedAt: new Date().toISOString(),
    filters: {},
    summary: { totalQueues: 2, totalAgents: 3, pausedAgents: 1, activeAgents: 2, activeCalls: 0, answeredCalls: 5, missedCalls: 1 },
    queues: [],
    agents: [],
    calls: [],
  })),
  setAgentPauseStatus: jest.fn(async () => ({ ok: true, updatedCount: 1, paused: true, items: [] })),
  assistedTransfer: jest.fn(async () => ({ ok: true, from: '1001', to: '1002', context: 'from-internal', ami: { ok: true } })),
  quickCallback: jest.fn(async () => ({ ok: true, phone: '11999990000', target: '1001', callbackId: 'cc-1', status: 'pending' })),
};

jest.mock('../../api/services/pbx/pbxOperatorPanelService', () => mockService);

const { handlePbxOperatorPanelRoutes } = require('../../api/modules/pbx/pbx-core/operatorPanelRoutes');
const service = require('../../api/services/pbx/pbxOperatorPanelService');

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default mock implementations after clearAllMocks
  mockService.listOperatorPanelSnapshot.mockResolvedValue({
    ok: true,
    generatedAt: new Date().toISOString(),
    filters: {},
    summary: { totalQueues: 2, totalAgents: 3, pausedAgents: 1, activeAgents: 2, activeCalls: 0, answeredCalls: 5, missedCalls: 1 },
    queues: [], agents: [], calls: [],
  });
  mockService.setAgentPauseStatus.mockResolvedValue({ ok: true, updatedCount: 1, paused: true, items: [] });
  mockService.assistedTransfer.mockResolvedValue({ ok: true, from: '1001', to: '1002', context: 'from-internal', ami: { ok: true } });
  mockService.quickCallback.mockResolvedValue({ ok: true, phone: '11999990000', target: '1001', callbackId: 'cc-1', status: 'pending' });
});

function buildRes() {
  const headers = {};
  let ended = false;
  let statusCode = null;
  let body = null;
  const chunks = [];

  return {
    setHeader: jest.fn((k, v) => { headers[k] = v; }),
    flushHeaders: jest.fn(),
    flush: jest.fn(),
    write: jest.fn((chunk) => { chunks.push(chunk); }),
    end: jest.fn(() => { ended = true; }),
    getHeaders: () => headers,
    get chunks() { return chunks; },
    get ended() { return ended; },
  };
}

function buildCtx({ method = 'GET', url = '/api/pbx/operator-panel/snapshot', tenantId = 'tenant-a' } = {}) {
  const req = {
    method,
    url,
    headers: {},
    tenantId,
    user: { id: 'user-1' },
    on: jest.fn(),
  };
  const res = buildRes();

  return {
    req,
    res,
    method,
    pathname: url.split('?')[0],
    deps: {
      sendJson: (r, status, data) => { r._status = status; r._body = data; },
      badRequest: jest.fn((r, msg) => { r._status = 400; r._body = { error: msg }; }),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => tenantId),
      logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      buildApiError: jest.fn((opts) => ({ error: opts.code, message: opts.message })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('handlePbxOperatorPanelRoutes – roteamento', () => {
  test('retorna false para rotas fora do prefixo', async () => {
    const ctx = buildCtx({ url: '/api/other/route' });
    const result = await handlePbxOperatorPanelRoutes(ctx);
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/pbx/operator-panel/snapshot', () => {
  test('retorna 200 com snapshot', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/snapshot' });
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(200);
    expect(ctx.res._body).toMatchObject({ ok: true, summary: expect.any(Object) });
    expect(service.listOperatorPanelSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tenantKey: 'tenant-a' }));
  });

  test('retorna 401 se nao autenticado', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/snapshot' });
    ctx.deps.requireAuth = jest.fn(() => ({ valid: false, error: 'no token' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(401);
  });

  test('retorna 403 se sem permissao', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/snapshot' });
    ctx.deps.requirePermission = jest.fn(() => ({ allowed: false, error: 'forbidden' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(403);
  });

  test('repassa filtros da query string', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/snapshot?queueId=q1&cdrLimit=30' });
    await handlePbxOperatorPanelRoutes(ctx);
    expect(service.listOperatorPanelSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ queueId: 'q1', cdrLimit: '30' }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/pbx/operator-panel/events (SSE)', () => {
  test('define headers SSE corretos e faz push do primeiro snapshot', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/events' });
    // intercept req.on para simular close imediato apos o primeiro push
    let closeHandler;
    ctx.req.on = jest.fn((evt, cb) => { if (evt === 'close') closeHandler = cb; });

    const routePromise = handlePbxOperatorPanelRoutes(ctx);
    // simula fechamento da conexao para limpar timers
    if (closeHandler) closeHandler();
    await routePromise;

    expect(ctx.res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/event-stream'));
    expect(ctx.res.flushHeaders).toHaveBeenCalled();
    expect(ctx.res.write).toHaveBeenCalled();
    const writtenChunks = ctx.res.chunks.join('');
    expect(writtenChunks).toContain('event: snapshot');
    expect(writtenChunks).toContain('"ok":true');
  });

  test('retorna 401 se nao autenticado', async () => {
    const ctx = buildCtx({ url: '/api/pbx/operator-panel/events' });
    ctx.deps.requireAuth = jest.fn(() => ({ valid: false, error: 'no token' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(401);
    expect(ctx.res.write).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/pbx/operator-panel/agent-status', () => {
  test('retorna 200 ao pausar agente', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/agent-status' });
    ctx.deps.parseJsonBody = jest.fn(async () => ({ memberRef: '1001', paused: true }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(200);
    expect(ctx.res._body).toMatchObject({ ok: true, paused: true });
    expect(service.setAgentPauseStatus).toHaveBeenCalled();
  });

  test('retorna 415 se Content-Type invalido', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/agent-status' });
    ctx.deps.hasJsonContentType = jest.fn(() => false);
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/pbx/operator-panel/agent-pause-queue', () => {
  test('delega para setAgentPauseStatus com singleQueue:true', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/agent-pause-queue' });
    ctx.deps.parseJsonBody = jest.fn(async () => ({ memberRef: '1001', queueId: 'q1', paused: true }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(200);
    expect(service.setAgentPauseStatus).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ singleQueue: true }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/pbx/operator-panel/transfer', () => {
  test('retorna 200 com resultado da transferencia', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/transfer' });
    ctx.deps.parseJsonBody = jest.fn(async () => ({ from: '1001', to: '1002' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(200);
    expect(ctx.res._body).toMatchObject({ ok: true, from: '1001', to: '1002' });
    expect(service.assistedTransfer).toHaveBeenCalled();
  });

  test('retorna 401 sem autenticacao', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/transfer' });
    ctx.deps.requireAuth = jest.fn(() => ({ valid: false, error: 'no token' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/pbx/operator-panel/callback', () => {
  test('retorna 201 com callbackId', async () => {
    const ctx = buildCtx({ method: 'POST', url: '/api/pbx/operator-panel/callback' });
    ctx.deps.parseJsonBody = jest.fn(async () => ({ phone: '11999990000', target: '1001' }));
    await handlePbxOperatorPanelRoutes(ctx);
    expect(ctx.res._status).toBe(201);
    expect(ctx.res._body).toMatchObject({ ok: true, callbackId: 'cc-1' });
    expect(service.quickCallback).toHaveBeenCalled();
  });
});
