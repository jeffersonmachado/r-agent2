/**
 * Testes unitários de endpoint: biometria no totem /physical/kiosk/tickets
 */

const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function httpJson({ port, path, method }, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('kiosk biometria', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_BYPASS = 'true';
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_BYPASS;
  });

  test('modo verify-1to1 exige biometricRef e customerIdInput quando requireBiometric=true', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tenantId: 'tenant-1',
      locationId: 'loja-1',
      tokenId: 'pat-1',
      kind: 'kiosk',
      meta: { biometricMode: 'verify-1to1', requireBiometric: true, biometricSecret: 's1' },
    }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));

    const createTicket = jest.fn(async () => ({ id: 'pt-1', ticket_number: '001', status: 'waiting' }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ createTicket }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'POST',
      path: '/physical/kiosk/tickets?token=pub_123',
    }, { priority: 0 });

    expect(r.status).toBe(400);
    expect(createTicket).not.toHaveBeenCalled();

    await new Promise((resolve) => server.close(resolve));
  });

  test('modo dedupe-only devolve ticket existente (idempotente) quando já existe hoje', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));

    // DB models mockados para dedupe (PhysicalTicket.sequelize.query)
    const sequelize = {
      query: jest.fn(async () => [[{ id: 'pt-existing', ticket_number: '777', status: 'waiting', context: {} }]]),
    };
    jest.doMock('../../api/db/models', () => ({
      defineRelationships: jest.fn(),
      PhysicalTicket: () => ({ sequelize }),
    }));

    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tenantId: 'tenant-1',
      locationId: 'loja-1',
      tokenId: 'pat-1',
      kind: 'kiosk',
      meta: { biometricMode: 'dedupe-only', requireBiometric: true, biometricSecret: 's1' },
    }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));

    const createTicket = jest.fn(async () => ({ id: 'pt-new' }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ createTicket }));

    // eslint-disable-next-line global-require
    const { signBiometricRef } = require('../../api/services/biometricService');
    const biometricRef = signBiometricRef({
      secret: 's1',
      payload: {
        v: 1,
        ts: Date.now(),
        nonce: 'n-123456',
        tokenId: 'pat-1',
        locationId: 'loja-1',
        mode: 'dedupe-only',
        subjectId: 'anon:abc',
      },
    });

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'POST',
      path: '/physical/kiosk/tickets?token=pub_123',
    }, { biometricMode: 'dedupe-only', biometricRef, priority: 0 });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, idempotent: true, ticket: { id: 'pt-existing', ticket_number: '777' } });
    expect(createTicket).not.toHaveBeenCalled();

    await new Promise((resolve) => server.close(resolve));
  });
});

