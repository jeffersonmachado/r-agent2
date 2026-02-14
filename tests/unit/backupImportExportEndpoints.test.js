const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/services/authService', () => ({
  validateToken: jest.fn(() => ({
    valid: true,
    agent: { id: 'ag-1', username: 'admin', tenantId: 'system', role: 'owner' },
    session: { id: 'sess-1' },
  })),
}));

jest.mock('../../api/services/rbacService', () => ({
  hasPermission: jest.fn(() => true),
}));

jest.mock('../../api/services/superAdminService', () => ({
  isSuperAdmin: jest.fn(() => false),
}));

function httpJson({ port, path, method, headers }, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function listenOrSkip(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        resolve({ skip: true });
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    try {
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        if (address && typeof address === 'object') {
          resolve({ skip: false, port: address.port });
        } else {
          resolve({ skip: true });
        }
      });
    } catch (error) {
      server.off('error', onError);
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        resolve({ skip: true });
        return;
      }
      reject(error);
    }
  });
}

describe('backup export/import endpoints', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_BYPASS = 'true';
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_BYPASS;
  });

  test('POST /api/backup/import + GET /api/backup/export roundtrip básico', async () => {
    const flowStore = new Map();
    const settingStore = new Map();

    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
      queryLogs: jest.fn(() => []),
    }));
    jest.doMock('../../api/db/models', () => ({
      defineRelationships: jest.fn(),
      Flow: () => ({
        findAll: jest.fn(async ({ where }) => {
          const tenant = String(where?.tenant_key || '');
          return [...flowStore.values()].filter((f) => f.tenant_key === tenant);
        }),
        findByPk: jest.fn(async (id) => flowStore.get(String(id)) || null),
        create: jest.fn(async (payload) => {
          const row = {
            ...payload,
            async update(next) {
              Object.assign(this, next);
              flowStore.set(String(this.id), this);
              return this;
            },
          };
          flowStore.set(String(payload.id), row);
          return row;
        }),
      }),
      TenantSetting: () => ({
        findAll: jest.fn(async ({ where }) => {
          const tenant = String(where?.tenant_id || '');
          return [...settingStore.values()]
            .filter((s) => s.tenant_id === tenant)
            .map((s) => ({
              toJSON: () => ({ tenant_id: s.tenant_id, key: s.key, value: s.value }),
            }));
        }),
        findOne: jest.fn(async ({ where }) => {
          const key = `${String(where?.tenant_id || '')}:${String(where?.key || '')}`;
          const found = settingStore.get(key);
          if (!found) return null;
          return {
            ...found,
            async update(next) {
              Object.assign(this, next);
              settingStore.set(key, this);
              return this;
            },
          };
        }),
        create: jest.fn(async (payload) => {
          const key = `${String(payload.tenant_id)}:${String(payload.key)}`;
          const row = {
            ...payload,
            async update(next) {
              Object.assign(this, next);
              settingStore.set(key, this);
              return this;
            },
          };
          settingStore.set(key, row);
          return row;
        }),
      }),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;
    const port = listenResult.port;

    const importPayload = {
      overwrite: true,
      flows: [{ id: 'flow-backup-1', name: 'Backup Flow 1', nodes: [] }],
      settings: [{ key: 'phone-masking', value: { enabled: true } }],
    };

    const importRes = await httpJson(
      {
        port,
        method: 'POST',
        path: '/api/backup/import',
        headers: {
          Authorization: 'Bearer token-test',
          'X-Tenant-Id': 'system',
        },
      },
      importPayload,
    );

    expect(importRes.status).toBe(200);
    expect(importRes.body).toMatchObject({
      ok: true,
      flowImported: 1,
      flowSkipped: 0,
      settingImported: 1,
      overwrite: true,
    });

    const exportRes = await httpJson({
      port,
      method: 'GET',
      path: '/api/backup/export',
      headers: {
        Authorization: 'Bearer token-test',
        'X-Tenant-Id': 'system',
      },
    });

    expect(exportRes.status).toBe(200);
    expect(exportRes.body).toMatchObject({
      ok: true,
      tenantId: 'system',
    });
    expect(Array.isArray(exportRes.body.flows)).toBe(true);
    expect(Array.isArray(exportRes.body.settings)).toBe(true);
    expect(exportRes.body.flows.find((f) => f.id === 'flow-backup-1')).toBeTruthy();
    expect(exportRes.body.settings.find((s) => s.key === 'phone-masking')).toBeTruthy();

    await new Promise((resolve) => server.close(resolve));
  });
});
