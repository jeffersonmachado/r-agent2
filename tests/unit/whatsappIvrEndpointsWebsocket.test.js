const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('WhatsApp IVR endpoints websocket emission', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function listenOrSkip(server) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          resolve({ skip: true });
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        if (address && typeof address === 'object') {
          resolve({ skip: false, port: address.port });
          return;
        }
        resolve({ skip: true });
      });
    });
  }

  function startServerWithMocks() {
    const settingsStore = {
      whatsapp_ivr: {
        enabled: true,
        departments: [],
        rules: [],
      },
    };

    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    jest.doMock('../../api/services/outboundWorker', () => ({ start: jest.fn(), stop: jest.fn() }));
    jest.doMock('../../api/services/channelHealthService', () => ({ startChannelHealthMonitor: jest.fn() }));
    jest.doMock('../../api/services/handoverService', () => ({ startAutoReturnToBot: jest.fn() }));
    jest.doMock('../../api/services/assignmentService', () => ({ startAssignmentWorker: jest.fn() }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ initialize: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/queueService', () => ({ startAutoCleanup: jest.fn() }));

    const emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({
      initializeWebSocket: jest.fn(),
      emitEvent,
    }));

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
      upsertSetting: jest.fn(async ({ key, value }) => {
        settingsStore[key] = value;
        return { ok: true, value };
      }),
    }));

    jest.doMock('../../api/middleware/auth', () => ({
      requireAuth: jest.fn((req) => {
        req.tenantId = 'tenant-test';
        req.agent = { id: 'agent-1', username: 'agent', tenantId: 'tenant-test' };
        return { valid: true, agent: req.agent };
      }),
      requirePermission: jest.fn(() => ({ allowed: true })),
    }));

    jest.doMock('../../api/services/superAdminService', () => ({ isSuperAdmin: jest.fn(() => false) }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      emitEvent,
    };
  }

  async function httpPostJson({ port, path, body }) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  test('POST /whatsapp/ivr emite whatsapp.ivr.updated', async () => {
    const { server, emitEvent } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const res = await httpPostJson({
      port: listenResult.port,
      path: '/whatsapp/ivr',
      body: { enabled: false, departments: [], rules: [] },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(res.status).toBe(200);
    expect(emitEvent).toHaveBeenCalledWith(
      'whatsapp.ivr.updated',
      expect.objectContaining({ value: expect.any(Object) }),
      { tenantId: 'tenant-test' }
    );
  });

  test('POST /whatsapp/ivr/department emite whatsapp.ivr.updated', async () => {
    const { server, emitEvent } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const res = await httpPostJson({
      port: listenResult.port,
      path: '/whatsapp/ivr/department',
      body: { name: 'Financeiro', queue: 'fila-financeiro', enabled: true },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(res.status).toBe(200);
    expect(emitEvent).toHaveBeenCalledWith(
      'whatsapp.ivr.updated',
      expect.objectContaining({ value: expect.any(Object) }),
      { tenantId: 'tenant-test' }
    );
  });

  test('POST /whatsapp/ivr/rule emite whatsapp.ivr.updated', async () => {
    const { server, emitEvent } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    await httpPostJson({
      port: listenResult.port,
      path: '/whatsapp/ivr/department',
      body: { id: 'dept-1', name: 'Financeiro', queue: 'fila-financeiro', enabled: true },
    });

    emitEvent.mockClear();

    const res = await httpPostJson({
      port: listenResult.port,
      path: '/whatsapp/ivr/rule',
      body: { keyword: 'boleto', departmentId: 'dept-1', priority: 1, enabled: true },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(res.status).toBe(200);
    expect(emitEvent).toHaveBeenCalledWith(
      'whatsapp.ivr.updated',
      expect.objectContaining({ value: expect.any(Object) }),
      { tenantId: 'tenant-test' }
    );
  });
});
