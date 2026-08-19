'use strict';

/**
 * Regressão: violações de ENUM de contrato devem retornar 400, nunca 500.
 *
 * Falha observada (sondagem 2026-07-27):
 * - POST /api/ai-governance/event com eventType fora do ENUM caía no CHECK do
 *   Postgres e voltava 500.
 * - POST /api/knowledge-graph/node com type fora dos 19 valores válidos idem.
 * Erro de contrato do cliente é 400 com a lista de valores aceitos; 500 é
 * reservado para falhas internas.
 */

jest.mock('../../api/modules/ai-governance/service', () => ({
  logGovernanceEvent: jest.fn(async ({ eventType }) => ({ id: 'rec-1', eventType })),
  getAuditTrail: jest.fn(async () => []),
  getDecisionLog: jest.fn(async () => []),
  generateComplianceReport: jest.fn(async () => ({})),
}));

jest.mock('../../api/modules/knowledge-graph/service', () => ({
  upsertNode: jest.fn(async ({ type, label }) => ({ id: 'node-1', type, label })),
  createEdge: jest.fn(async () => ({ id: 'edge-1' })),
  getNode: jest.fn(async () => null),
  getRelatedNodes: jest.fn(async () => ({})),
  querySubgraph: jest.fn(async () => ({})),
}));

const governanceService = require('../../api/modules/ai-governance/service');
const kgService = require('../../api/modules/knowledge-graph/service');
const { handleAiGovernanceRoutes } = require('../../api/modules/agent-os/routes/ai-governance');
const { handleKnowledgeGraphRoutes } = require('../../api/modules/agent-os/routes/knowledge-graph');

function makeReq(body) {
  const stream = require('stream');
  const payload = JSON.stringify(body || {});
  const req = new stream.Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.url = '/';
  req.originalUrl = '/';
  req.query = {};
  // Fail-closed (W1-A): as rotas exigem tenant explícito; antes o fallback
  // silencioso `req.tenant_id || 'system'` mascarava a ausência no harness.
  req.tenantId = 'tenant-qa';
  return req;
}

function makeRes() {
  return { statusCode: null, body: null, writableEnded: false };
}

function baseDeps() {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data || '{}');
    },
    logAction: async () => {},
  };
}

describe('POST /api/ai-governance/event — validação de eventType', () => {
  beforeEach(() => jest.clearAllMocks());

  test('eventType fora do ENUM retorna 400 e não toca o banco', async () => {
    const res = makeRes();
    await handleAiGovernanceRoutes({
      req: makeReq({ eventType: 'agent_validation', agentId: null }),
      res,
      method: 'POST',
      pathname: '/api/ai-governance/event',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.body && res.body.message)).toMatch(/eventType/i);
    expect(governanceService.logGovernanceEvent).not.toHaveBeenCalled();
  });

  test('eventType válido retorna 201', async () => {
    const res = makeRes();
    await handleAiGovernanceRoutes({
      req: makeReq({ eventType: 'audit', description: 'evento QA' }),
      res,
      method: 'POST',
      pathname: '/api/ai-governance/event',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(201);
    expect(governanceService.logGovernanceEvent).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/knowledge-graph/node — validação de type', () => {
  beforeEach(() => jest.clearAllMocks());

  test('type fora do ENUM retorna 400 e não toca o banco', async () => {
    const res = makeRes();
    await handleKnowledgeGraphRoutes({
      req: makeReq({ type: 'Unicorn', label: 'nó inválido' }),
      res,
      method: 'POST',
      pathname: '/api/knowledge-graph/node',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.body && res.body.message)).toMatch(/type/i);
    expect(kgService.upsertNode).not.toHaveBeenCalled();
  });

  test('type válido retorna 201', async () => {
    const res = makeRes();
    await handleKnowledgeGraphRoutes({
      req: makeReq({ type: 'Journey', label: 'jornada QA' }),
      res,
      method: 'POST',
      pathname: '/api/knowledge-graph/node',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(201);
    expect(kgService.upsertNode).toHaveBeenCalledTimes(1);
  });
});
