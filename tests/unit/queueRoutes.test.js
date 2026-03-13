describe('queueRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listQueues: jest.fn(() => ['Support', 'Sales']),
      createQueue: jest.fn(() => ({ success: true, queueName: 'newq', message: 'Fila criada' })),
      getQueueInfo: jest.fn(() => ({ name: 'support', size: 3 })),
      deleteQueue: jest.fn(() => ({ success: true, message: 'deletada' })),
      listQueue: jest.fn(() => []),
      canAccessTicket: jest.fn(() => true),
      queueDefinitionService: {
        listQueues: jest.fn(() => [{ name: 'Delivery' }, { name: 'Support' }]),
        upsertQueue: jest.fn(async () => {}),
      },
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      tenantId: 'tenant-1',
      url: '/',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'agent-1', username: 'alice', role: 'admin' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ── rota não tratada ──────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const deps = makeDeps();
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res: {},
      method: 'PATCH',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(false);
  });

  // ── GET /queues ────────────────────────────────────────────────────────────

  test('GET /queues retorna 401 sem autenticacao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token inválido' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, { error: 'unauthorized', message: 'token inválido' });
  });

  test('GET /queues retorna 403 sem permissao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissao' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, { error: 'forbidden', message: 'sem permissao' });
  });

  test('GET /queues retorna merge de filas legadas e persistidas', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({
      listQueues: jest.fn(() => ['Support', 'Sales', 'Support']),
      queueDefinitionService: {
        listQueues: jest.fn(() => [{ name: 'Delivery' }, { name: 'Sales' }]),
        upsertQueue: jest.fn(async () => {}),
      },
    });

    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.queueDefinitionService.listQueues).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, ['Delivery', 'Sales', 'Support']);
  });

  // ── POST /queues ───────────────────────────────────────────────────────────

  test('POST /queues retorna 401 sem autenticacao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'nao autenticado' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('POST /queues retorna 403 sem permissao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'proibido' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('POST /queues valida content-type', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('Content-Type'));
  });

  test('POST /queues exige campo name', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('"name"'));
  });

  test('POST /queues cria fila e registra auditoria', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'VIP' })),
      createQueue: jest.fn(() => ({ success: true, queueName: 'VIP', message: 'Fila criada' })),
    });

    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/queues',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.createQueue).toHaveBeenCalledWith('VIP');
    expect(deps.queueDefinitionService.upsertQueue).toHaveBeenCalledWith(expect.objectContaining({ name: 'VIP' }));
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue_create', resourceId: 'VIP' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ success: true }));
  });

  test('POST /queues retorna 200 quando fila ja existe', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'existing' })),
      createQueue: jest.fn(() => ({ success: true, queueName: 'existing', message: 'Fila já existe' })),
    });

    await handleQueueRoutes({ req: makeReq(), res, method: 'POST', pathname: '/queues', deps });

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('POST /queues retorna badRequest quando createQueue falha', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'bad' })),
      createQueue: jest.fn(() => ({ success: false, message: 'Nome inválido' })),
    });

    await handleQueueRoutes({ req: makeReq(), res, method: 'POST', pathname: '/queues', deps });

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Nome inválido');
  });

  // ── GET /queues/:name ─────────────────────────────────────────────────────

  test('GET /queues/:name retorna 401 sem autenticacao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'nao autenticado' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues/support',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /queues/:name retorna badRequest para fila invalida', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ getQueueInfo: jest.fn(() => null) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues/invalida',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('inválido'));
  });

  test('GET /queues/:name retorna info da fila', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const queueInfo = { name: 'support', size: 5 };
    const deps = makeDeps({ getQueueInfo: jest.fn(() => queueInfo) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues/support',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.getQueueInfo).toHaveBeenCalledWith('support');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, queueInfo);
  });

  // ── DELETE /queues/:name ──────────────────────────────────────────────────

  test('DELETE /queues/:name retorna 401 sem autenticacao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'nao autenticado' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'DELETE',
      pathname: '/queues/oldq',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('DELETE /queues/:name retorna 404 quando fila nao encontrada', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ deleteQueue: jest.fn(() => ({ success: false, message: 'Fila não encontrada' })) });
    const handled = await handleQueueRoutes({
      req: makeReq({ url: '/queues/ghost' }),
      res,
      method: 'DELETE',
      pathname: '/queues/ghost',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ success: false }));
  });

  test('DELETE /queues/:name apaga fila e registra auditoria', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({
      deleteQueue: jest.fn(() => ({ success: true, message: 'Fila excluída', deletedTickets: 2 })),
    });
    const handled = await handleQueueRoutes({
      req: makeReq({ url: '/queues/oldq?force=true' }),
      res,
      method: 'DELETE',
      pathname: '/queues/oldq',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.deleteQueue).toHaveBeenCalledWith('oldq', true);
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue_delete', resourceId: 'oldq' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── GET /queues/:queue/tickets ────────────────────────────────────────────

  test('GET /queues/:queue/tickets retorna 401 sem autenticacao', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'nao autenticado' })) });
    const handled = await handleQueueRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/queues/support/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /queues/:queue/tickets lista tickets para admin', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const tickets = [{ id: 't1' }, { id: 't2' }];
    const deps = makeDeps({ listQueue: jest.fn(() => tickets) });

    const handled = await handleQueueRoutes({
      req: makeReq({ url: '/queues/support/tickets' }),
      res,
      method: 'GET',
      pathname: '/queues/support/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.listQueue).toHaveBeenCalledWith('support', expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, tickets);
  });

  test('GET /queues/:queue/tickets filtra por permissao para agent', async () => {
    const { handleQueueRoutes } = require('../../api/serverHandlers/queueRoutes');

    const res = {};
    const t1 = { id: 't1', assignedTo: 'agent-1' };
    const t2 = { id: 't2', assignedTo: 'other' };
    const deps = makeDeps({
      listQueue: jest.fn(() => [t1, t2]),
      canAccessTicket: jest.fn((agent, ticket) => ticket.assignedTo === agent.id),
    });

    const handled = await handleQueueRoutes({
      req: makeReq({ agent: { id: 'agent-1', username: 'alice', role: 'agent' } }),
      res,
      method: 'GET',
      pathname: '/queues/support/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.canAccessTicket).toHaveBeenCalledTimes(2);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, [t1]);
  });
});

