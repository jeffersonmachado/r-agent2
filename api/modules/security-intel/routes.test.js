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
  createPatchMission: jest.fn(),
}));
jest.mock('../../services/securityIntel/securityIntelWorker', () => ({
  getSecurityIntelWorkerStatus: jest.fn(),
  getLatestAdvisorySyncAge: jest.fn(),
}));
jest.mock('../../services/securityIntel/waiverService', () => ({
  listWaivers: jest.fn(),
  createWaiver: jest.fn(),
  revokeWaiver: jest.fn(),
}));
jest.mock('../../services/securityIntel/triageService', () => ({
  buildTriage: jest.fn(),
}));

const inventoryStoreService = require('../../services/securityIntel/inventoryStoreService');
const vulnerabilityScanService = require('../../services/securityIntel/vulnerabilityScanService');
const sbomService = require('../../services/securityIntel/sbomService');
const patchPlanService = require('../../services/securityIntel/patchPlanService');
const securityIntelWorker = require('../../services/securityIntel/securityIntelWorker');
const waiverService = require('../../services/securityIntel/waiverService');
const triageService = require('../../services/securityIntel/triageService');

const { createSecurityIntelRoutes } = require('./routes');

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
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function buildServer(agent, { authenticated = true, permission = null } = {}) {
  const deps = {
    requireAuth: jest.fn((req) => {
      if (!authenticated) return { valid: false, error: 'Token de autenticação não fornecido' };
      req.agent = agent;
      if (Object.prototype.hasOwnProperty.call(agent, 'tenantId')) {
        req.tenantId = agent.tenantId;
      }
      return { valid: true, agent };
    }),
    // `permission` permite exercitar a autorização POR AÇÃO: recebe
    // (req, resource, action) e devolve { allowed }. O default libera tudo para
    // que os testes de segregação/tenant não dependam do RBAC.
    requirePermission: jest.fn(typeof permission === 'function'
      ? permission
      : () => (permission || { allowed: true })),
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

  it('mapeia recusa de política de waiver para HTTP com o código do motivo (não 500)', async () => {
    const refusal = new Error('waiver_exceeds_max_days:90');
    refusal.code = 'waiver_exceeds_max_days';
    refusal.statusCode = 400;
    waiverService.createWaiver.mockImplementation(() => Promise.reject(refusal));
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('waiver_exceeds_max_days');
    expect(res.body.detail).toBe('90');
  });

  it('recusa isentar achado que não é risco aberto com 409 (maquiagem de métrica)', async () => {
    const refusal = new Error('waiver_not_needed_for_vex_state:NOT_AFFECTED');
    refusal.code = 'waiver_not_needed_for_vex_state';
    refusal.statusCode = 409;
    waiverService.createWaiver.mockImplementation(() => Promise.reject(refusal));
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('waiver_not_needed_for_vex_state');
  });

  it('revogar waiver inexistente responde 404, não 500', async () => {
    const missing = new Error('waiver_not_found:abc');
    missing.code = 'waiver_not_found';
    missing.statusCode = 404;
    waiverService.revokeWaiver.mockImplementation(() => Promise.reject(missing));
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers/revoke');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('waiver_not_found');
  });

  it('GET /triage devolve a fila do MESMO serviço usado pelo CLI', async () => {
    triageService.buildTriage.mockResolvedValue({
      tenantKey: 'system',
      totals: { groups: 28, autoIsolated: 19, requiringHumanApproval: 4, withoutPublishedFix: 5 },
      groups: [{ packageName: 'transformers', bucket: 'WAIVER_OR_COMPENSATING_CONTROL', command: 'node scripts/security-intel.js waive ...' }],
    });
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'GET', '/api/security-intel/triage');
    expect(res.status).toBe(200);
    expect(res.body.totals.groups).toBe(28);
    expect(res.body.groups[0].command).toContain('waive');
    // Uma única fonte para a fila: a rota não recolhe dados por conta própria.
    expect(triageService.buildTriage).toHaveBeenCalledWith({ tenantKey: 'system' });
  });

  // ── Autoridade de aprovação (achado P0 de 2026-10-10) ────────────────────

  it('RECUSA identidade autodeclarada: approvedBy no corpo não autoriza nada (400)', async () => {
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers', {}, {
      findingKey: 'pkg@1.0.0#x',
      reason: 'motivo com substância suficiente',
      approvedBy: 'diretor-fantasma',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('approval_identity_not_accepted');
    expect(res.body.field).toBe('approvedBy');
    // A tentativa é recusada ANTES de qualquer efeito: nada é gravado.
    expect(waiverService.createWaiver).not.toHaveBeenCalled();
  });

  it('RECUSA authorizedBy autodeclarado ao submeter missão (400)', async () => {
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/patch-mission', {}, {
      candidateKey: 'c1',
      authorizedBy: 'cto-fantasma',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('approval_identity_not_accepted');
    expect(patchPlanService.createPatchMission).not.toHaveBeenCalled();
  });

  it('aprovador do waiver é DERIVADO do ator autenticado (não do corpo)', async () => {
    waiverService.createWaiver.mockResolvedValue({
      waiverKey: 'w1',
      created: true,
      waiver: { expires_at: '2026-11-01T00:00:00.000Z', approved_by: 'engineer' },
    });
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers', {}, {
      findingKey: 'pkg@1.0.0#x',
      reason: 'motivo com substância suficiente',
    });
    expect(res.status).toBe(201);
    expect(waiverService.createWaiver).toHaveBeenCalledWith(expect.objectContaining({
      approvedBy: 'engineer',
      createdBy: 'engineer',
    }));
  });

  it('autorização da missão também é DERIVADA do ator autenticado', async () => {
    patchPlanService.createPatchMission.mockResolvedValue({ missionId: 'm1', created: true, candidateKey: 'c1' });
    server = await buildServer(DEVELOPER);
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/patch-mission', {}, { candidateKey: 'c1' });
    expect(res.status).toBe(202);
    expect(patchPlanService.createPatchMission).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'engineer',
      authorizedBy: 'engineer',
    }));
  });

  it('SEM permissão de aprovar risco devolve 403 e não toca serviço', async () => {
    server = await buildServer(DEVELOPER, {
      permission: (req, resource, action) => ({ allowed: action === 'read' }),
    });
    port = server.address().port;
    const res = await request(port, 'POST', '/api/security-intel/waivers', {}, {
      findingKey: 'pkg@1.0.0#x',
      reason: 'motivo com substância suficiente',
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden', resource: 'security_intel', action: 'waiver_approve' });
    expect(waiverService.createWaiver).not.toHaveBeenCalled();
  });

  it('autorização é POR AÇÃO: ter leitura NÃO abre escrita (mesmo server, mesmas sessão)', async () => {
    server = await buildServer(DEVELOPER, {
      permission: (req, resource, action) => ({ allowed: action === 'read' }),
    });
    port = server.address().port;
    const leitura = await request(port, 'GET', '/api/security-intel/summary');
    expect(leitura.status).toBe(200);
    const missao = await request(port, 'POST', '/api/security-intel/patch-mission', {}, { candidateKey: 'c1' });
    expect(missao.status).toBe(403);
    expect(missao.body).toMatchObject({ error: 'forbidden', action: 'patch_mission' });
    const scan = await request(port, 'POST', '/api/security-intel/scan', {}, { scope: 'installed' });
    expect(scan.status).toBe(403);
    expect(scan.body.action).toBe('scan');
  });
});
