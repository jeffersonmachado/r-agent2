describe('physicalPublicRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      checkRateLimit: jest.fn(async () => ({ allowed: true })),
      logAction: jest.fn(),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/x',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const deps = makeDeps();
    const handled = await handlePhysicalPublicRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
  });

  test('POST /physical/kiosk/tickets valida content-type', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken: jest.fn() }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq();
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/kiosk/tickets', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /physical/kiosk/tickets retorna 401 sem token', async () => {
    const resolvePublicToken = jest.fn();
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/kiosk/tickets' });
    const res = {};
    const deps = makeDeps();

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/kiosk/tickets', deps });

    expect(handled).toBe(true);
    expect(resolvePublicToken).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'Token obrigatório',
    });
  });

  test('POST /physical/kiosk/tickets retorna 429 no rate limit', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-k1', tenantId: 'tenant-1', locationId: 'loc-1' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/kiosk/tickets?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 11 })) });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/kiosk/tickets', deps });

    expect(handled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 11);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 11 segundos.',
      retryAfter: 11,
    });
  });

  test('POST /physical/kiosk/tickets cria senha com sucesso', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-k2', tenantId: 'tenant-1', locationId: 'loc-1', meta: {} }));
    const createTicket = jest.fn(async () => ({ id: 'tk-1', ticket_number: 10, physical_queue_id: 'q-1' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ createTicket }));
    jest.doMock('../../api/services/biometricService', () => ({ verifyBiometricRef: jest.fn() }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/kiosk/tickets?token=abc', headers: { 'user-agent': 'jest' } });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        priority: 2,
        queueId: 'q-1',
        context: { idempotencyKey: 'idem-1' },
      })),
    });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/kiosk/tickets', deps });

    expect(handled).toBe(true);
    expect(createTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      locationId: 'loc-1',
      queueId: 'q-1',
      priority: 2,
      context: {
        idempotencyKey: 'idem-1',
        publicTokenId: 'pt-k2',
        locationId: 'loc-1',
        biometricMode: null,
        biometricSubjectId: null,
        customerIdInput: null,
      },
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      ticket: { id: 'tk-1', ticket_number: 10, physical_queue_id: 'q-1' },
    });
  });

  test('POST /physical/kiosk/tickets mapeia invalid_biometric_ref para 401', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-k3', tenantId: 'tenant-1', locationId: 'loc-1', meta: {} }));
    const createTicket = jest.fn(async () => {
      const err = new Error('invalid biometric');
      err.code = 'invalid_biometric_ref_signature';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ createTicket }));
    jest.doMock('../../api/services/biometricService', () => ({ verifyBiometricRef: jest.fn() }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/kiosk/tickets?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ queueId: 'q-1' })) });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/kiosk/tickets', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'Biometria inválida',
    });
  });

  test('GET /physical/panel/state retorna 429 no rate limit', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-p1', tenantId: 'tenant-1', locationId: 'loc-2' }));
    const getPanelState = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ getPanelState }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/panel/state?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 9 })) });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'GET', pathname: '/physical/panel/state', deps });

    expect(handled).toBe(true);
    expect(getPanelState).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 9 segundos.',
      retryAfter: 9,
    });
  });

  test('GET /physical/panel/state retorna estado', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-p2', tenantId: 'tenant-1', locationId: 'loc-2' }));
    const getPanelState = jest.fn(async () => ({ waiting: 4, inService: 1 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ getPanelState }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/panel/state?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'GET', pathname: '/physical/panel/state', deps });

    expect(handled).toBe(true);
    expect(getPanelState).toHaveBeenCalledWith({ tenantId: 'tenant-1', locationId: 'loc-2' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      waiting: 4,
      inService: 1,
    });
  });
});
