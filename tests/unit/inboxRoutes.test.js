describe('inboxRoutes handler', () => {
  let handleInboxRoutes;

  function makeDeps(overrides = {}) {
    const ticket = { id: 't1', tenantId: 'tenant1', queue: 'support', assignedTo: null };
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listAllTickets: jest.fn(() => [ticket]),
      getTicket: jest.fn(() => ticket),
      canAccessTicket: jest.fn(() => true),
      canModifyTicket: jest.fn(() => true),
      assignTicket: jest.fn(() => ({ ...ticket, assignedTo: 'a1' })),
      transferTicket: jest.fn(() => ({ ...ticket, queue: 'billing' })),
      addTicketNote: jest.fn(() => ({ ...ticket, notes: [{ note: 'ok' }] })),
      triggerWebhooks: jest.fn(async () => {}),
      emitEvent: jest.fn(),
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/inbox/conversations',
      tenantId: 'tenant1',
      agent: { id: 'a1', username: 'alice', role: 'admin' },
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handleInboxRoutes = require('../../api/serverHandlers/inboxRoutes').handleInboxRoutes;
  });

  // ── rota não tratada ────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleInboxRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });
    expect(handled).toBe(false);
  });

  // ── GET /inbox/conversations ────────────────────────────────────────────

  test('GET /inbox/conversations retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });
    const handled = await handleInboxRoutes({ req: makeReq({ url: '/inbox/conversations' }), res, method: 'GET', pathname: '/inbox/conversations', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /inbox/conversations lista tickets do tenant', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleInboxRoutes({ req: makeReq({ url: '/inbox/conversations' }), res, method: 'GET', pathname: '/inbox/conversations', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ tickets: expect.any(Array), total: expect.any(Number) }));
  });

  test('GET /inbox/conversations filtra por status via query param', async () => {
    // status=open is handled in-memory (passed as undefined to listAllTickets)
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ url: '/inbox/conversations?status=closed' });
    const handled = await handleInboxRoutes({ req, res, method: 'GET', pathname: '/inbox/conversations', deps });
    expect(handled).toBe(true);
    expect(deps.listAllTickets).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
  });

  // ── GET /inbox/conversations/:id ────────────────────────────────────────

  test('GET /inbox/conversations/:id retorna ticket', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'GET', pathname: '/inbox/conversations/t1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ id: 't1' }));
  });

  test('GET /inbox/conversations/:id retorna 404 se nao encontrado', async () => {
    const res = {};
    const deps = makeDeps({ getTicket: jest.fn(() => null) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'GET', pathname: '/inbox/conversations/t999', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'ticket_not_found' }));
  });

  test('GET /inbox/conversations/:id retorna 403 sem acesso', async () => {
    const res = {};
    const deps = makeDeps({ canAccessTicket: jest.fn(() => false) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'GET', pathname: '/inbox/conversations/t1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  // ── POST /inbox/conversations/:id/assign ───────────────────────────────

  test('POST /inbox/conversations/:id/assign atribui ticket', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ assignedTo: 'a2' })) });
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'admin' } });
    const handled = await handleInboxRoutes({ req, res, method: 'POST', pathname: '/inbox/conversations/t1/assign', deps });
    expect(handled).toBe(true);
    expect(deps.assignTicket).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  test('POST /inbox/conversations/:id/assign agent nao pode atribuir a outros', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ assignedTo: 'a2' })) });
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleInboxRoutes({ req, res, method: 'POST', pathname: '/inbox/conversations/t1/assign', deps });
    expect(handled).toBe(true);
    // Should assign to self (a1), not a2
    expect(deps.assignTicket).toHaveBeenCalledWith('t1', 'a1');
  });

  // ── POST /inbox/conversations/:id/transfer ─────────────────────────────

  test('POST /inbox/conversations/:id/transfer retorna 400 sem queue', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'POST', pathname: '/inbox/conversations/t1/transfer', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /inbox/conversations/:id/transfer transfere ticket', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ queue: 'billing' })) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'POST', pathname: '/inbox/conversations/t1/transfer', deps });
    expect(handled).toBe(true);
    expect(deps.transferTicket).toHaveBeenCalledWith('t1', expect.objectContaining({ queue: 'billing' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  // ── POST /inbox/conversations/:id/notes ────────────────────────────────

  test('POST /inbox/conversations/:id/notes retorna 400 sem note', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ note: '' })) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'POST', pathname: '/inbox/conversations/t1/notes', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /inbox/conversations/:id/notes adiciona nota', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ note: 'Nota interna' })) });
    const handled = await handleInboxRoutes({ req: makeReq(), res, method: 'POST', pathname: '/inbox/conversations/t1/notes', deps });
    expect(handled).toBe(true);
    expect(deps.addTicketNote).toHaveBeenCalledWith('t1', 'Nota interna', expect.any(Object));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });
});
