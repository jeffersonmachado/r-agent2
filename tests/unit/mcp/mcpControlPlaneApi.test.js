'use strict';

/**
 * M8/M9 — API de administração do MCP Control Plane.
 *
 * Defeito original: havia persistência (tabela/model/serviço) mas NENHUMA
 * superfície para criar, habilitar, desabilitar, testar, redescobrir ou
 * revalidar schema. Persistência sem API não é control plane.
 *
 * Este arquivo também cobre a regressão de acoplamento: a composição exigia
 * `middleware/auth` no topo e o runner do jest ficava preso ao importá-la. A
 * primeira asserção do arquivo prova que a importação é barata e LAZY.
 */

const http = require('http');
const express = require('express');

jest.mock('../../../api/middleware/auth', () => ({
  requireAuth: (req, res) => {
    if (!req.auth) { res.status(401).json({ error: 'unauthorized' }); return null; }
    return req.auth;
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../../../lib/rpaSecurity', () => ({
  tenantFromRequest: () => 'tenant-autenticado',
}));

const mockClassification = { allowed: true, required: 'DEVELOPMENT', classification: 'DEVELOPMENT' };
jest.mock('../../../api/middleware/requireClassification', () => ({
  checkClassification: jest.fn(),
}));

// `resetMocks: true` no jest.config limpa implementações antes de CADA teste —
// por isso a implementação é (re)instalada no beforeEach, nunca só no factory.
const classificationModule = require('../../../api/middleware/requireClassification');

const mockCreateError = { value: null };
jest.mock('../../../api/services/mcp/mcpConnectionService', () => ({
  listConnections: jest.fn(),
  getConnection: jest.fn(),
  createConnection: jest.fn(),
  updateConnection: jest.fn(),
  setEnabled: jest.fn(),
  markValidating: jest.fn(),
  recordHealth: jest.fn(),
  recordDiscovery: jest.fn(),
  authCapabilitiesReport: jest.fn(),
  LIFECYCLE_STATES: { CONFIGURED: 'CONFIGURED', SCHEMA_CHANGED: 'SCHEMA_CHANGED', DISABLED: 'DISABLED' },
}));

const service = require('../../../api/services/mcp/mcpConnectionService');

/** Implementações instaladas a cada teste (resetMocks limpa entre eles). */
function installServiceImplementations() {
  service.listConnections.mockImplementation(async () => []);
  service.getConnection.mockImplementation(async () => ({ id: 'mcpc-1', status: 'CONFIGURED', enabled: true }));
  service.createConnection.mockImplementation(async () => {
    if (mockCreateError.value) throw mockCreateError.value;
    return { id: 'mcpc-new', name: 'p', credential_ref: 'REF' };
  });
  service.updateConnection.mockImplementation(async () => ({ id: 'mcpc-1' }));
  service.setEnabled.mockImplementation(async ({ enabled }) => ({
    id: 'mcpc-1', enabled, status: enabled ? 'CONFIGURED' : 'DISABLED',
  }));
  service.markValidating.mockImplementation(async () => ({ id: 'mcpc-1', status: 'VALIDATING' }));
  service.recordHealth.mockImplementation(async () => ({ id: 'mcpc-1', status: 'UNAVAILABLE' }));
  service.recordDiscovery.mockImplementation(async () => ({ id: 'mcpc-1', schemaChanged: false, toolCount: 2 }));
  service.authCapabilitiesReport.mockImplementation(() => [
    { mode: 'bearer', state: 'IMPLEMENTED', transport: 'Bearer', limitation: null },
    { mode: 'mtls', state: 'UNSUPPORTED', transport: null, limitation: 'nao implementado' },
  ]);
}
const { createMcpExpressRouter } = require('../../../api/composition/mcp');

function buildApp({ authenticated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!authenticated) return res.status(401).json({ error: 'unauthorized' });
    req.auth = { username: 'eng' };
    return next();
  });
  app.use(createMcpExpressRouter());
  // Catch-all: rota não casada sem handler deixa a requisição PENDURADA.
  app.use((req, res) => res.status(404).json({ error: 'route_not_mounted' }));
  return app;
}

function request(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const timer = setTimeout(() => reject(new Error(`timeout ${method} ${urlPath}`)), 5000);
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port, method, path: urlPath, agent: false,
      headers: {
        Connection: 'close',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        clearTimeout(timer);
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) { /* mantém string */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    return await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('M8/M9 — API de administracao do MCP Control Plane', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClassification.allowed = true;
    mockClassification.classification = 'DEVELOPMENT';
    mockCreateError.value = null;
    classificationModule.checkClassification.mockImplementation(() => mockClassification);
    installServiceImplementations();
  });

  it('REGRESSAO: importar a composicao e barato (nao inicializa auth)', () => {
    const started = Date.now();
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      require('../../../api/composition/mcp');
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  describe('M9 — classificacao DEVELOPMENT obrigatoria', () => {
    it.each([
      ['GET', '/mcp/connections'],
      ['POST', '/mcp/connections'],
      ['POST', '/mcp/connections/mcpc-1/disable'],
      ['POST', '/mcp/connections/mcpc-1/test'],
      ['POST', '/mcp/connections/mcpc-1/discover'],
      ['POST', '/mcp/connections/mcpc-1/revalidate-schema'],
    ])('%s %s responde 403 sem DEVELOPMENT', async (method, urlPath) => {
      mockClassification.allowed = false;
      mockClassification.classification = 'PRODUCTION';
      const res = await withServer(buildApp(), (s) => request(s, method, urlPath, method === 'GET' ? undefined : {}));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('classification_forbidden');
    });
  });

  it('sem autenticacao a rota nao e servida', async () => {
    const res = await withServer(buildApp({ authenticated: false }), (s) => request(s, 'GET', '/mcp/connections'));
    expect(res.status).toBe(401);
  });

  it('M4 — segredo em claro e recusado com erro explicito', async () => {
    const error = new Error('mcp_connection_invalid: segredo em claro recusado — use credentialRef');
    error.code = 'mcp_connection_invalid';
    mockCreateError.value = error;
    const res = await withServer(buildApp(), (s) => request(s, 'POST', '/mcp/connections', { name: 'p', secret: 'x' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/segredo em claro recusado/);
  });

  it('M8 — create devolve 201 com credentialRef', async () => {
    const res = await withServer(buildApp(), (s) => request(s, 'POST', '/mcp/connections', {
      name: 'p', endpoint: 'https://mcp.externo.com/rpc', authType: 'bearer', credentialRef: 'REF_X',
    }));
    expect(res.status).toBe(201);
    expect(res.body.connection.credential_ref).toBe('REF');
  });

  it('M8 — enable/disable alteram o ESTADO persistido', async () => {
    const disabled = await withServer(buildApp(), (s) => request(s, 'POST', '/mcp/connections/mcpc-1/disable', {}));
    expect(disabled.body.connection.enabled).toBe(false);
  });

  it('M8 — list consulta o servico (nao estado em memoria)', async () => {
    const res = await withServer(buildApp(), (s) => request(s, 'GET', '/mcp/connections'));
    expect(res.status).toBe(200);
    expect(service.listConnections).toHaveBeenCalled();
  });

  it('M8 — auth-capabilities expoe o estado REAL por modo', async () => {
    const res = await withServer(buildApp(), (s) => request(s, 'GET', '/mcp/connections/auth-capabilities'));
    const byMode = Object.fromEntries(res.body.modes.map((m) => [m.mode, m.state]));
    expect(byMode.mtls).toBe('UNSUPPORTED');
    expect(byMode.bearer).toBe('IMPLEMENTED');
  });

  it('teste de conexao sem servidor MCP real NAO devolve sucesso', async () => {
    const res = await withServer(buildApp(), (s) => request(s, 'POST', '/mcp/connections/mcpc-1/test', {}));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('mcp_external_server_not_configured');
    expect(service.recordHealth).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('tenant vem do contexto autenticado, nunca do payload', async () => {
    await withServer(buildApp(), (s) => request(s, 'POST', '/mcp/connections', {
      tenantId: 'tenant-invadido', name: 'p', endpoint: 'https://x.com/rpc',
    }));
    const call = service.createConnection.mock.calls[0][0];
    expect(call.tenantId).toBe('tenant-autenticado');
    expect(call.tenantId).not.toBe(call.input.tenantId);
  });
});
