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

  test('POST /physical/access/resolve delega ao decision engine com token publico bound ao device', async () => {
    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tokenId: 'pt-ac-1',
      tenantId: 'tenant-1',
      locationId: 'loc-ac-1',
      kind: 'access_control',
      meta: { deviceId: 'dev-1', vertical: 'fitness' },
    }));
    const resolveDecision = jest.fn(async () => ({
      decision: { id: 'dec-1', decision: 'allow', reason_code: 'allowed_active' },
      token: 'signed-decision',
      event: { id: 'evt-1' },
    }));
    const getDevice = jest.fn(async () => ({ id: 'dev-1', vendor: 'Control iD', model: 'IDBlock' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/modules/access-control/accessDecisionService', () => ({ resolveDecision }));
    jest.doMock('../../api/modules/access-control/accessControlService', () => ({ getDevice }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/access/resolve?token=abc', headers: { 'user-agent': 'jest' } });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        credential_value: 'qr-123',
        action: 'enter',
      })),
    });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/access/resolve', deps });

    expect(handled).toBe(true);
    expect(resolveDecision).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      deviceId: 'dev-1',
      credentialValue: 'qr-123',
      action: 'enter',
      vertical: 'fitness',
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      token: 'signed-decision',
      execution_command: expect.objectContaining({
        vendor: 'control_id',
        deviceId: 'dev-1',
        action: 'ALLOW',
      }),
    }));
  });

  test('POST /physical/access/resolve bloqueia device divergente do token', async () => {
    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tokenId: 'pt-ac-2',
      tenantId: 'tenant-1',
      locationId: 'loc-ac-1',
      kind: 'access_control',
      meta: { deviceId: 'dev-bound' },
    }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/modules/access-control/accessDecisionService', () => ({ resolveDecision: jest.fn() }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/access/resolve?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        device_id: 'dev-other',
        credential_value: 'qr-123',
      })),
    });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/access/resolve', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'device_id divergente do token público',
    });
  });

  test('POST /physical/access/events registra evento via token publico', async () => {
    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tokenId: 'pt-ac-3',
      tenantId: 'tenant-1',
      locationId: 'loc-ac-1',
      kind: 'access_control',
      meta: { deviceId: 'dev-2' },
    }));
    const createEvent = jest.fn(async ({ payload }) => ({ id: 'evt-22', ...payload }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/modules/access-control/accessControlService', () => ({ createEvent }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/access/events?token=abc', headers: { 'user-agent': 'jest' } });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        event_type: 'entry',
        direction: 'in',
        subject_id: 'sub-1',
      })),
    });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/access/events', deps });

    expect(handled).toBe(true);
    expect(createEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      payload: expect.objectContaining({
        device_id: 'dev-2',
        event_type: 'entry',
        direction: 'in',
        subject_id: 'sub-1',
        metadata: expect.objectContaining({
          publicTokenId: 'pt-ac-3',
          publicLocationId: 'loc-ac-1',
          reportedBy: 'public_access_device',
        }),
      }),
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({
      ok: true,
      item: expect.objectContaining({ id: 'evt-22' }),
    }));
  });

  test('POST /physical/access/ack registra confirmação de execução do hardware', async () => {
    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tokenId: 'pt-ac-4',
      tenantId: 'tenant-1',
      locationId: 'loc-ac-1',
      kind: 'access_control',
      meta: { deviceId: 'dev-9', vendor: 'Control iD' },
    }));
    const createEvent = jest.fn(async ({ payload }) => ({ id: 'evt-ack', ...payload }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/modules/access-control/accessControlService', () => ({ createEvent }));
    const { handlePhysicalPublicRoutes } = require('../../api/serverHandlers/physicalPublicRoutes');

    const req = makeReq({ url: '/physical/access/ack?token=abc', headers: { 'user-agent': 'jest' } });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        decision_id: 'dec-1',
        subject_id: 'sub-1',
        status: 'executed',
        command: 'ALLOW',
        hardware_response: { relay: 'opened' },
      })),
    });

    const handled = await handlePhysicalPublicRoutes({ req, res, method: 'POST', pathname: '/physical/access/ack', deps });

    expect(handled).toBe(true);
    expect(createEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      payload: expect.objectContaining({
        device_id: 'dev-9',
        subject_id: 'sub-1',
        decision_id: 'dec-1',
        event_type: 'device_callback',
        raw_payload: expect.objectContaining({
          ack: true,
          status: 'executed',
          command: 'ALLOW',
          vendor: 'Control iD',
          hardware_response: { relay: 'opened' },
        }),
        metadata: expect.objectContaining({
          publicTokenId: 'pt-ac-4',
          publicLocationId: 'loc-ac-1',
          reportedBy: 'public_access_device_ack',
        }),
      }),
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({
      ok: true,
      item: expect.objectContaining({ id: 'evt-ack' }),
    }));
  });
});
