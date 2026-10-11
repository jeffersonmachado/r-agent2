'use strict';

/**
 * Guard do módulo de governança de engenharia.
 *
 * O que este teste protege:
 *   1. FAIL-CLOSED de verdade: sem auth (401), sem classificação DEVELOPMENT
 *      (403), ação não declarada (403), sem permissão por ação (403), sem tenant
 *      (400) — e o serviço NÃO é tocado em nenhum desses casos;
 *   2. NÃO-VACUIDADE da tabela `ROUTE_ACTIONS`: toda rota montada no router tem
 *      entrada declarada. Rota nova sem entrada é negada, não herdada — e este
 *      teste falha se alguém esquecer (em vez de a falha aparecer em produção);
 *   3. ação mutante sem `confirm` é recusada ANTES de qualquer execução.
 */

const http = require('http');
const express = require('express');

jest.mock('../../middleware/requireClassification', () => ({
  checkClassification: jest.fn(),
}));
jest.mock('../../services/devGovernance/pendenciesService', () => ({
  getPendencies: jest.fn(),
}));
jest.mock('../../services/devGovernance/releaseStateService', () => ({
  getReleaseState: jest.fn(),
}));

const { checkClassification } = require('../../middleware/requireClassification');
const pendenciesService = require('../../services/devGovernance/pendenciesService');
const releaseStateService = require('../../services/devGovernance/releaseStateService');
const {
  createDevGovernanceRoutes,
  ROUTE_ACTIONS,
  ROUTE_RELEASE_ACTION,
} = require('./routes');

function request(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const finalHeaders = payload === null
      ? headers
      : { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: finalHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function startServer(deps) {
  const app = express();
  app.use(express.json());
  app.use(createDevGovernanceRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const AUTH_OK = { valid: true, agent: { id: 1, username: 'eng', role: 'super_admin', tenantId: 'system' } };

describe('dev-governance — guard fail-closed', () => {
  let server;
  let port;
  let deps;

  beforeEach(async () => {
    deps = {
      requireAuth: jest.fn(() => AUTH_OK),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: (res, status, payload) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); },
      hasJsonContentType: (req) => String(req.headers['content-type'] || '').includes('application/json'),
      parseJsonBody: (req) => req.body || {},
      badRequest: jest.fn(),
    };
    checkClassification.mockReturnValue({ allowed: true, classification: 'DEVELOPMENT', required: 'DEVELOPMENT' });
    pendenciesService.getPendencies.mockResolvedValue({ summary: { total: 0 }, items: [], sourceUnavailable: [] });
    releaseStateService.getReleaseState.mockResolvedValue({ verdict: 'NOT_SEALED', actions: [], artifacts: { delivered: [], candidate: [] } });
    ({ server, port } = await startServer(deps));
  });

  afterEach((done) => {
    jest.clearAllMocks();
    server.close(done);
  });

  it('sem autenticação ⇒ 401 e nenhum serviço tocado', async () => {
    deps.requireAuth.mockReturnValue({ valid: false, error: 'token ausente' });
    const res = await request(port, 'GET', '/api/dev-governance/pendencies');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(pendenciesService.getPendencies).not.toHaveBeenCalled();
  });

  it('sem classificação DEVELOPMENT ⇒ 403 e nenhum serviço tocado', async () => {
    checkClassification.mockReturnValue({ allowed: false, classification: 'PRODUCTION', required: 'DEVELOPMENT' });
    const res = await request(port, 'GET', '/api/dev-governance/release');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('classification_required');
    expect(releaseStateService.getReleaseState).not.toHaveBeenCalled();
  });

  it('sem a permissão DA AÇÃO ⇒ 403 forbidden (não basta ter acesso à tela)', async () => {
    deps.requirePermission.mockReturnValue({ allowed: false, error: 'Permissão negada: read em dev_governance' });
    const res = await request(port, 'GET', '/api/dev-governance/pendencies');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.action).toBe('read');
    expect(pendenciesService.getPendencies).not.toHaveBeenCalled();
  });

  it('sem tenant resolvido ⇒ 400 (tenant nunca é assumido)', async () => {
    deps.requireAuth.mockReturnValue({ valid: true, agent: { id: 1, username: 'eng', role: 'super_admin' } });
    const res = await request(port, 'GET', '/api/dev-governance/pendencies');
    expect(res.status).toBe(400);
    expect(['tenant_required', 'tenant_invalid']).toContain(res.body.error);
    expect(pendenciesService.getPendencies).not.toHaveBeenCalled();
  });

  it('caminho feliz devolve as pendências com o filtro aplicado', async () => {
    const res = await request(port, 'GET', '/api/dev-governance/pendencies?onlyPending=1');
    expect(res.status).toBe(200);
    expect(pendenciesService.getPendencies).toHaveBeenCalledWith({ tenantKey: 'system', onlyPending: true });
  });

  it('ação mutante sem confirmação ⇒ 400 ANTES de qualquer execução', async () => {
    const res = await request(port, 'POST', '/api/dev-governance/release/seal', {}, { confirm: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('confirmation_required');
  });

  it('ação mutante com guard bloqueando ⇒ recusa com o motivo (não executa)', async () => {
    releaseStateService.getReleaseState.mockResolvedValue({
      verdict: 'SUPERSEDED',
      releaseName: 'r-agent2-20261011-083027',
      actions: [{ id: 'publish-tag', enabled: false, blockedReason: 'guard local recusa push de tag' }],
      artifacts: { delivered: [], candidate: [] },
    });
    const res = await request(port, 'POST', '/api/dev-governance/release/publish-tag', {}, { confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('release_action_unavailable');
    expect(res.body.detail).toMatch(/guard local recusa push de tag/);
  });
});

describe('dev-governance — não-vacuidade das tabelas de rota', () => {
  it('toda rota montada tem ação declarada (fail-closed não pode ter buraco)', () => {
    const router = createDevGovernanceRoutes({ buildDeps: () => ({}) });
    const montadas = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method] !== true) continue;
        montadas.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
    expect(montadas.length).toBeGreaterThan(0);
    for (const rota of montadas) {
      expect(Object.keys(ROUTE_ACTIONS)).toContain(rota);
    }
  });

  it('toda rota de AÇÃO tem ação do catálogo executável mapeada', () => {
    for (const [rota, actionId] of Object.entries(ROUTE_RELEASE_ACTION)) {
      expect(Object.keys(ROUTE_ACTIONS)).toContain(rota);
      expect(['verify', 'seal', 'publish-tag']).toContain(actionId);
    }
    expect(Object.keys(ROUTE_RELEASE_ACTION)).toHaveLength(3);
  });
});
