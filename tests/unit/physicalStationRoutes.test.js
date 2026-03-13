describe('physicalStationRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      checkRateLimit: jest.fn(async () => ({ allowed: true })),
      logAction: jest.fn(),
      createTicket: jest.fn(() => ({ id: 'ticket-created' })),
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
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const deps = makeDeps();
    const handled = await handlePhysicalStationRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
  });

  test('POST /physical/station/call-next valida content-type', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken: jest.fn() }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq();
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/call-next', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /physical/station/call-next retorna 429 no rate limit', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s1', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const callNext = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ callNext }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/call-next?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 8 })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/call-next', deps });

    expect(handled).toBe(true);
    expect(callNext).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 8 segundos.',
      retryAfter: 8,
    });
  });

  test('POST /physical/station/call-next retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s2', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const callNext = jest.fn(async () => ({ id: 'tk-1', ticket_number: 22 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ callNext }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/call-next?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stationId: 'st-1' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/call-next', deps });

    expect(handled).toBe(true);
    expect(callNext).toHaveBeenCalledWith({ tenantId: 'tenant-1', locationId: 'loc-1', stationId: 'st-1' });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-1', ticket_number: 22 },
    });
  });

  test('POST /physical/station/finish exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s3', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const finishTicket = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ finishTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/finish?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/finish', deps });

    expect(handled).toBe(true);
    expect(finishTicket).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/finish mapeia ticket_not_found para 404', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s4', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const finishTicket = jest.fn(async () => {
      const err = new Error('missing');
      err.code = 'physical_ticket_not_found';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ finishTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/finish?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-404' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/finish', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'ticket_not_found',
      message: 'Senha não encontrada',
    });
  });

  test('POST /physical/station/finish retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s5', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const finishTicket = jest.fn(async () => ({ id: 'tk-5', ticket_number: 77, station_id: 'st-7' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ finishTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/finish?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-5' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/finish', deps });

    expect(handled).toBe(true);
    expect(finishTicket).toHaveBeenCalledWith({ tenantId: 'tenant-1', ticketId: 'tk-5' });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-5', ticket_number: 77, station_id: 'st-7' },
    });
  });

  test('POST /physical/station/start exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s6', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const startService = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ startService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/start?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stationId: 'st-2' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/start', deps });

    expect(handled).toBe(true);
    expect(startService).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/start mapeia invalid_transition para 409', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s7', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const startService = jest.fn(async () => {
      const err = new Error('invalid transition');
      err.code = 'physical_ticket_invalid_transition';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ startService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/start?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-7' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/start', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 409, {
      error: 'invalid_transition',
      message: 'Transição de estado inválida',
    });
  });

  test('POST /physical/station/start retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s8', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const startService = jest.fn(async () => ({ id: 'tk-8', ticket_number: 88, station_id: 'st-8' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ startService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/start?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-8', stationId: 'st-8', idempotencyKey: 'idem-8' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/start', deps });

    expect(handled).toBe(true);
    expect(startService).toHaveBeenCalledWith({ tenantId: 'tenant-1', ticketId: 'tk-8', stationId: 'st-8', idempotencyKey: 'idem-8' });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-8', ticket_number: 88, station_id: 'st-8' },
    });
  });

  test('POST /physical/station/skip exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s9', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const skipTicket = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ skipTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/skip?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ reason: 'x' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/skip', deps });

    expect(handled).toBe(true);
    expect(skipTicket).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/skip mapeia ticket_not_found para 404', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s10', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const skipTicket = jest.fn(async () => {
      const err = new Error('missing');
      err.code = 'physical_ticket_not_found';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ skipTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/skip?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-10' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/skip', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'ticket_not_found',
      message: 'Senha não encontrada',
    });
  });

  test('POST /physical/station/skip retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s11', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const skipTicket = jest.fn(async () => ({ id: 'tk-11', ticket_number: 111 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ skipTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/skip?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-11', stationId: 'st-11', reason: 'timeout', idempotencyKey: 'idem-11' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/skip', deps });

    expect(handled).toBe(true);
    expect(skipTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ticketId: 'tk-11',
      stationId: 'st-11',
      reason: 'timeout',
      idempotencyKey: 'idem-11',
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-11', ticket_number: 111 },
    });
  });

  test('POST /physical/station/pause exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s12', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const pauseService = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ pauseService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/pause?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stationId: 'st-12' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/pause', deps });

    expect(handled).toBe(true);
    expect(pauseService).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/pause mapeia invalid_transition para 409', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s13', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const pauseService = jest.fn(async () => {
      const err = new Error('invalid transition');
      err.code = 'physical_ticket_invalid_transition';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ pauseService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/pause?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-13' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/pause', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 409, {
      error: 'invalid_transition',
      message: 'Transição de estado inválida',
    });
  });

  test('POST /physical/station/pause retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s14', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const pauseService = jest.fn(async () => ({ id: 'tk-14', ticket_number: 114 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ pauseService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/pause?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-14', stationId: 'st-14', reason: 'break', idempotencyKey: 'idem-14' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/pause', deps });

    expect(handled).toBe(true);
    expect(pauseService).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ticketId: 'tk-14',
      stationId: 'st-14',
      reason: 'break',
      idempotencyKey: 'idem-14',
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-14', ticket_number: 114 },
    });
  });

  test('POST /physical/station/resume exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s15', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const resumeService = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ resumeService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/resume?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stationId: 'st-15' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/resume', deps });

    expect(handled).toBe(true);
    expect(resumeService).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/resume mapeia ticket_not_found para 404', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s16', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const resumeService = jest.fn(async () => {
      const err = new Error('missing');
      err.code = 'physical_ticket_not_found';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ resumeService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/resume?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-16' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/resume', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'ticket_not_found',
      message: 'Senha não encontrada',
    });
  });

  test('POST /physical/station/resume retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s17', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const resumeService = jest.fn(async () => ({ id: 'tk-17', ticket_number: 117 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ resumeService }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/resume?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-17', stationId: 'st-17', idempotencyKey: 'idem-17' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/resume', deps });

    expect(handled).toBe(true);
    expect(resumeService).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ticketId: 'tk-17',
      stationId: 'st-17',
      idempotencyKey: 'idem-17',
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-17', ticket_number: 117 },
    });
  });

  test('POST /physical/station/transfer exige ticketId e toQueueId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s18', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const transferTicket = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ transferTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/transfer?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-18' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/transfer', deps });

    expect(handled).toBe(true);
    expect(transferTicket).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campos "ticketId" e "toQueueId" são obrigatórios');
  });

  test('POST /physical/station/transfer mapeia ticket_not_found para 404', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s19', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const transferTicket = jest.fn(async () => {
      const err = new Error('missing');
      err.code = 'physical_ticket_not_found';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ transferTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/transfer?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-19', toQueueId: 'q-19' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/transfer', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'ticket_not_found',
      message: 'Senha não encontrada',
    });
  });

  test('POST /physical/station/transfer retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s20', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const transferTicket = jest.fn(async () => ({ id: 'tk-20', ticket_number: 120 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ transferTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/transfer?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-20', toQueueId: 'q-20', idempotencyKey: 'idem-20' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/transfer', deps });

    expect(handled).toBe(true);
    expect(transferTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ticketId: 'tk-20',
      toQueueId: 'q-20',
      idempotencyKey: 'idem-20',
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-20', ticket_number: 120 },
    });
  });

  test('POST /physical/station/abandon exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s21', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const abandonTicket = jest.fn();

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ abandonTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/abandon?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stationId: 'st-21' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/abandon', deps });

    expect(handled).toBe(true);
    expect(abandonTicket).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/abandon mapeia invalid_transition para 409', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s22', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const abandonTicket = jest.fn(async () => {
      const err = new Error('invalid transition');
      err.code = 'physical_ticket_invalid_transition';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ abandonTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/abandon?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-22' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/abandon', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 409, {
      error: 'invalid_transition',
      message: 'Transição de estado inválida',
    });
  });

  test('POST /physical/station/abandon retorna ticket', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s23', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const abandonTicket = jest.fn(async () => ({ id: 'tk-23', ticket_number: 123 }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ abandonTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/abandon?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'tk-23', stationId: 'st-23', reason: 'no-show', idempotencyKey: 'idem-23' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/abandon', deps });

    expect(handled).toBe(true);
    expect(abandonTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ticketId: 'tk-23',
      stationId: 'st-23',
      reason: 'no-show',
      idempotencyKey: 'idem-23',
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      ticket: { id: 'tk-23', ticket_number: 123 },
    });
  });

  test('POST /physical/station/open-support-ticket exige ticketId', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s24', tenantId: 'tenant-1', locationId: 'loc-1' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/open-support-ticket?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ queue: 'FastService' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/open-support-ticket', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "ticketId" é obrigatório');
  });

  test('POST /physical/station/open-support-ticket retorna 404 quando senha não existe', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s25', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const findOne = jest.fn(async () => null);
    const PhysicalTicket = jest.fn(() => ({ findOne }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/db/models', () => ({ PhysicalTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/open-support-ticket?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'ptk-25' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/open-support-ticket', deps });

    expect(handled).toBe(true);
    expect(findOne).toHaveBeenCalledWith({ where: { tenant_key: 'tenant-1', id: 'ptk-25' } });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'ticket_not_found',
      message: 'Senha não encontrada',
    });
  });

  test('POST /physical/station/open-support-ticket retorna idempotente quando já vinculado', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s26', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const row = {
      toJSON: jest.fn(() => ({
        ticket_number: 126,
        context: { supportTicketId: 'sup-existing-26' },
      })),
    };
    const findOne = jest.fn(async () => row);
    const PhysicalTicket = jest.fn(() => ({ findOne }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/db/models', () => ({ PhysicalTicket }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/open-support-ticket?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ticketId: 'ptk-26' })) });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/open-support-ticket', deps });

    expect(handled).toBe(true);
    expect(deps.createTicket).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      idempotent: true,
      ticketId: 'sup-existing-26',
    });
  });

  test('POST /physical/station/open-support-ticket cria ticket digital e retorna 201', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-s27', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const update = jest.fn(async () => {});
    const row = {
      toJSON: jest.fn(() => ({
        ticket_number: 127,
        context: { locationId: 'loc-row-27', correlationId: 'corr-27' },
      })),
      update,
    };
    const findOne = jest.fn(async () => row);
    const PhysicalTicket = jest.fn(() => ({ findOne }));
    const appendEventV1 = jest.fn(async () => {});
    const createTicket = jest.fn(() => ({ id: 'sup-27' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/db/models', () => ({ PhysicalTicket }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1 }));
    const { handlePhysicalStationRoutes } = require('../../api/serverHandlers/physicalStationRoutes');

    const req = makeReq({ url: '/physical/station/open-support-ticket?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      createTicket,
      parseJsonBody: jest.fn(async () => ({ ticketId: 'ptk-27', queue: 'Support', message: 'Ajuda no balcão' })),
    });

    const handled = await handlePhysicalStationRoutes({ req, res, method: 'POST', pathname: '/physical/station/open-support-ticket', deps });

    expect(handled).toBe(true);
    expect(createTicket).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      sessionId: 'physical_ptk-27',
      queue: 'Support',
      lastUserMessage: 'Ajuda no balcão',
      context: {
        escalationReason: 'physical_support_ticket',
        metadata: {
          kind: 'physical_support_ticket',
          physicalTicketId: 'ptk-27',
          ticketNumber: 127,
          locationId: 'loc-row-27',
          correlationId: 'corr-27',
        },
      },
      tags: ['fast_service', 'physical'],
    });
    expect(update).toHaveBeenCalledWith({
      context: { locationId: 'loc-row-27', correlationId: 'corr-27', supportTicketId: 'sup-27' },
    });
    expect(appendEventV1).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      ticket: { id: 'sup-27' },
    });
  });
});
