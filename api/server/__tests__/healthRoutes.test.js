'use strict';

function createResponseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('healthRoutes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../db/health');
  });

  test('despacha /version', async () => {
    const { handleHealthRoutes } = require('../healthRoutes');
    const res = createResponseMock();
    const handled = await handleHealthRoutes({
      res,
      method: 'GET',
      pathname: '/version',
      sendJson,
      logger: { error: jest.fn() },
      apiVersionInfo: {
        name: 'api',
        version: '1.0.0',
        serverVersion: '1.0.0',
        packageVersion: '1.0.0',
        versionMismatch: false,
        baseVersion: '1.0.0',
        commit: null,
        build: null,
      },
      nodeEnv: 'test',
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      name: 'api',
      version: '1.0.0',
      serverVersion: '1.0.0',
      packageVersion: '1.0.0',
      versionMismatch: false,
      baseVersion: '1.0.0',
      commit: null,
      build: null,
      env: 'test',
    });
  });

  test('despacha /ready como alias de readiness', async () => {
    jest.doMock('../../db/health', () => ({
      checkDbConnection: jest.fn().mockResolvedValue({ ok: true }),
      getMigrationStatusSafe: jest.fn().mockResolvedValue({ pendingCount: 0, pendingNames: [] }),
    }));
    const { handleHealthRoutes } = require('../healthRoutes');
    const res = createResponseMock();
    const handled = await handleHealthRoutes({
      res,
      method: 'GET',
      pathname: '/ready',
      sendJson,
      logger: { error: jest.fn() },
      apiVersionInfo: {},
      nodeEnv: 'test',
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'ready',
      db: 'ok',
      migrationsPending: 0,
    });
  });

  test('ignora rotas fora do escopo', async () => {
    const { handleHealthRoutes } = require('../healthRoutes');
    const res = createResponseMock();
    const handled = await handleHealthRoutes({
      res,
      method: 'GET',
      pathname: '/mkt/track.js',
      sendJson,
      logger: { error: jest.fn() },
      apiVersionInfo: {},
      nodeEnv: 'test',
    });

    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
