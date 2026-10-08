'use strict';

/**
 * Regressão dos guards da superfície de inteligência de versões/segurança.
 *
 * O que este teste protege (e que já custou caro em outras superfícies):
 *   1. autenticação ANTES de qualquer leitura (401, não 500 nem dado parcial);
 *   2. classificação DEVELOPMENT resolvida SERVER-SIDE — ator PRODUCTION recebe
 *      403 mesmo passando `?classification=DEVELOPMENT` na query (a query não
 *      escala privilégio);
 *   3. tenant NUNCA assumido: sem tenant resolvível a resposta é 400, e nenhum
 *      serviço é chamado (substituição silenciosa por 'system' é proibida);
 *   4. o resumo não mistura evidência VEX (NOT_AFFECTED/FALSE_POSITIVE) com risco
 *      aberto: `blockingFindings` conta só severidade bloqueante de risco.
 */

const express = require('express');
const http = require('http');

jest.mock('../../services/securityIntel/inventoryStoreService', () => ({
  getInventorySummary: jest.fn(),
  getInventory: jest.fn(),
  getLatestDiscoveryRun: jest.fn(),
}));
jest.mock('../../services/securityIntel/vulnerabilityScanService', () => ({
  getFindingSummary: jest.fn(),
  loadPolicy: jest.fn(),
}));
jest.mock('../../services/securityIntel/sbomService', () => ({
  getLatestSbomSnapshot: jest.fn(),
  listSbomSnapshots: jest.fn(),
}));
jest.mock('../../services/securityIntel/patchPlanService', () => ({
  listPatchCandidates: jest.fn(),
}));
jest.mock('../../services/securityIntel/securityIntelWorker', () => ({
  getSecurityIntelWorkerStatus: jest.fn(),
  getLatestAdvisorySyncAge: jest.fn(),
}));

const inventoryStoreService = require('../../services/securityIntel/inventoryStoreService');
const vulnerabilityScanService = require('../../services/securityIntel/vulnerabilityScanService');
const sbomService = require('../../services/securityIntel/sbomService');
const patchPlanService = require('../../services/securityIntel/patchPlanService');
const securityIntelWorker = require('../../services/securityIntel/securityIntelWorker');

const { createSecurityIntelRoutes } = require('./routes');

function request(port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildServer(agent, { authenticated = true } = {}) {
  const deps = {
    requireAuth: jest.fn((req) => {
      if (!authenticated) return { valid: false, error: 'Token de autenticação não fornecido' };
      req.agent = agent;
      if (Object.prototype.hasOwnProperty.call(agent, 'tenantId')) {
        req.tenantId = agent.tenantId;
      }
      return { valid: true, agent };
    }),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: message }),
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
  };
  const app = express();
  app.use(express.json());
  app.use(createSecurityIntelRoutes({ buildDeps: () => deps }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

const DEVELOPER = { id: 'a1', username: 'engineer', role: 'super_admin', tenantId: 'system' };
const OPERATOR = { id: 'a2', username: 'operador', role: 'operator', tenantId: 'tenant-x' };

const POLICY = {
  advisorySources: { osv: { maxAgeHoursBeforeStale: 72 } },
  releaseGate: {
    blockOnSeverity: ['CRITICAL', 'HIGH'],
    blockOnDevDependencies: false,
    blockWhenKevWithoutFix: true,
    minCoveragePercent: 80,
    maxWaiverDays: 90,
  },
};

function primeSummaryMocks() {
  inventoryStoreService.getInventorySummary.mockResolvedValue({ tenantKey: 'system', total: 1653 });
  inventoryStoreService.getLatestDiscoveryRun.mockResolvedValue({
    id: 'run-1', status: 'PASS', started_at: new Date(Date.now() - 3600000).toISOString(),
    coverage: { coveragePercent: 100 }, unavailable: [], drift: [{ verdict: 'drift' }],
  });
  vulnerabilityScanService.loadPolicy.mockReturnValue(POLICY);
  vulnerabilityScanService.getFindingSummary.mockResolvedValue({
    tenantKey: 'system',
    open: 81,
    kevOpen: 0,
    bySeverity: { CRITICAL: 2, HIGH: 30 },
    byStatus: { NOT_AFFECTED: 312 },
    vex: { total: 312, bySeverity: { INFORMATIONAL: 312 } },
  });
  sbomService.getLatestSbomSnapshot.mockResolvedValue({
    id: 'snap-1', sha256: 'abc', component_count: 1653, validation: { valid: true },
  });
  sbomService.listSbomSnapshots.mockResolvedValue([]);
  patchPlanService.listPatchCandidates.mockResolvedValue({ total: 44, items: [] });
  securityIntelWorker.getSecurityIntelWorkerStatus.mockReturnValue({ health: 'UP', running: true });
  securityIntelWorker.getLatestAdvisorySyncAge.mockResolvedValue(1.5);
}

describe('security-intel routes — segregação DEVELOPMENT e fail-closed', () => {
  let server;
  let port;

  beforeEach(() => {
    primeSummaryMocks();
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  it('nega requisição anônima com 401 e não consulta serviço', async () => {
    server = await buildServer(null, { authenticated: false });
    port = server.address().port;
    const res = await request(port, 'GET', '/api/security-intel/summary');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(inventoryStoreService.getInventorySummary).not.toHaveBeenCalled();
  });

  it('nega ator PRODUCTION com 403 mesmo declarando classificação na query', async () => {
    server = await buildServer(OPERATOR);
    port = server.address().port;
    const res = await request(
      port,
      'GET',
      '/api/security-intel/summary?classification=DEVELOPMENT',
      { 'x-classification': 'DEVELOPMENT' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('classification_required');
    expect(inventoryStoreService.getInventorySummary).not.toHaveBeenCalled();
  });

  it('nega ator DEVELOPMENT sem tenant resolvível com 400 (não assume system)', async () => {
    server = await buildServer({ ...DEVELOPER, tenantId: null });
    port = server.address().port;
    const res = await request(port, 'GET', '/api/security-intel/summary');
    expect(res.status).toBe(400);
    expect(['tenant_required', 'tenant_invalid']).toContain(res.body.error);
    expect(inventoryStoreService.getInventorySummary).not.toHaveBeenCalled();
  });

  it('responde 200 para ator DEVELOPMENT com tenant e separa risco de evidência VEX', async () => {
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'GET', '/api/security-intel/summary');
    expect(res.status).toBe(200);
    // 2 CRITICAL + 30 HIGH; as 312 linhas VEX (INFORMATIONAL) ficam fora.
    expect(res.body.blockingFindings).toBe(32);
    expect(res.body.vexEvaluations).toBe(312);
    expect(res.body.findings.bySeverity.INFORMATIONAL).toBeUndefined();
    expect(res.body.advisoryBase).toMatchObject({ stale: false, staleAfterHours: 72 });
    expect(inventoryStoreService.getInventorySummary).toHaveBeenCalledWith({ tenantKey: 'system' });
  });

  it('marca a base de advisories como vencida quando a idade excede o limite', async () => {
    securityIntelWorker.getLatestAdvisorySyncAge.mockResolvedValue(200);
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'GET', '/api/security-intel/summary');
    expect(res.status).toBe(200);
    expect(res.body.advisoryBase.stale).toBe(true);
  });

  it('propaga falha de persistência como 503 em vez de dado parcial', async () => {
    const err = new Error('database offline');
    err.code = 'persistence_required';
    inventoryStoreService.getInventory.mockImplementation(() => Promise.reject(err));
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    // Rota /inventory (e não /summary): o setup global do Jest deste repo envolve
    // `Promise.all` com um `.finally()` derivado (tests/setup.js, "proteção contra
    // promises pendentes"), o que transforma uma rejeição JÁ TRATADA em unhandled
    // rejection e faz o teste falhar com o erro original. /inventory usa um único
    // await, então exercita o mesmo mapeamento de erro sem o artefato do harness.
    const res = await request(port, 'GET', '/api/security-intel/inventory');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('persistence_required');
  });
});
