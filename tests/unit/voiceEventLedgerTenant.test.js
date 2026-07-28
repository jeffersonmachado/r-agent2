'use strict';

/**
 * Regressão: GET /api/event-ledger (e demais endpoints tenant-scoped do
 * módulo voice) respondia 200 silencioso quando req.tenantId era null
 * (super-admin sem header X-Tenant-Id). A query ia ao banco com
 * tenant_key vazio e devolvia lista vazia — o chamador não tinha como
 * distinguir "tenant sem eventos" de "tenant não selecionado".
 *
 * Comportamento correto (padrão composition/shared/requireTenant.js):
 * tenant ausente → 403 tenant_required, explícito, antes de tocar o banco.
 * Tenant presente → fluxo normal.
 */

const express = require('express');
const http = require('http');

jest.mock('../../api/services/eventLedgerService', () => ({
  listEvents: (async ({ tenantId }) => ({
    ok: true, total: 0, items: [], limit: 200, offset: 0, tenantEcho: tenantId,
  })),
}));
jest.mock('../../api/services/voiceEventService', () => ({
  getVoiceMetrics: (async () => ({ ok: true, calls: 0 })),
  ingestVoiceEvent: (async () => ({ ok: true, id: 'evt-1' })),
}));
jest.mock('../../api/services/voiceRuntimeService', () => ({
  getVoiceRuntimeStats: (() => ({ sessions: 0 })),
  clearVoiceSession: (() => true),
  startVoiceSession: (() => {}),
  stepVoiceSession: (() => {}),
}), { virtual: true });

const { createVoiceRoutes } = require('../../api/modules/voice/routes');

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildServer(tenantId) {
  const deps = {
    // Nota: jest.config usa resetMocks — jest.fn criado no beforeAll perde a
    // implementação antes de cada teste. Por isso funções simples aqui.
    requireAuth: (req) => {
      req.tenantId = tenantId;
      req.agent = { id: 'a1', role: 'super_admin' };
      return { valid: true, agent: req.agent };
    },
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body || {},
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  };
  const app = express();
  app.use(express.json());
  app.use(createVoiceRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('módulo voice — tenant explícito obrigatório', () => {
  let serverSemTenant;
  let serverComTenant;

  beforeAll(async () => {
    serverSemTenant = await buildServer(null);
    serverComTenant = await buildServer('tenant-a');
  });
  afterAll(async () => {
    await new Promise((r) => serverSemTenant.close(r));
    await new Promise((r) => serverComTenant.close(r));
  });

  it('GET /api/event-ledger sem tenant → 403 tenant_required (não 200 silencioso)', async () => {
    const res = await request(serverSemTenant.address().port, 'GET', '/api/event-ledger');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'tenant_required' }));
  });

  it('GET /api/event-ledger com tenant → 200 normal', async () => {
    const res = await request(serverComTenant.address().port, 'GET', '/api/event-ledger');
    expect(res.status).toBe(200);
    expect(res.body.tenantEcho).toBe('tenant-a');
  });

  it('GET /api/voice/metrics sem tenant → 403 tenant_required', async () => {
    const res = await request(serverSemTenant.address().port, 'GET', '/api/voice/metrics');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'tenant_required' }));
  });

  it('POST /api/voice/events sem tenant → 403 tenant_required', async () => {
    const res = await request(serverSemTenant.address().port, 'POST', '/api/voice/events', { eventType: 'call_started' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'tenant_required' }));
  });

  it('GET /api/voice/runtime/stats sem tenant → 403 tenant_required', async () => {
    const res = await request(serverSemTenant.address().port, 'GET', '/api/voice/runtime/stats');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'tenant_required' }));
  });

  it('GET /api/voice/runtime/stats com tenant → 200 normal', async () => {
    const res = await request(serverComTenant.address().port, 'GET', '/api/voice/runtime/stats');
    expect(res.status).toBe(200);
  });
});
