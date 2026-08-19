'use strict';

/**
 * HARD-019 — Regressão do bug de ordenação tenant/requireAuth nas rotas
 * agent-os (marketplace, knowledge-graph, orchestrator, ai-governance,
 * journey-registry, rap-learn, vertical-templates).
 *
 * Bug: `const tenantId = req.tenantId || req.agent?.tenantId || null` era
 * resolvido ANTES do requireAuth do branch (que é quem popula req.agent e
 * req.tenantId). Com o hardening fail-closed da W1-A, requests autenticadas
 * COM tenant passaram a falhar com 400 tenant_required (o fallback
 * `req.tenant_id || 'system'` anterior mascarava a ordem).
 *
 * Contrato testado:
 * (a) requireAuth populando req.tenantId dentro do branch → request autenticada
 *     com tenant chega ao service com o tenant correto;
 * (b) requireAuth que não popula tenant → 400 tenant_required (fail-closed
 *     preservado), service NÃO é chamado.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockQueryGraph = jest.fn(async () => ({ nodes: [], edges: [] }));

jest.mock('../../api/modules/knowledge-graph/service', () => ({
  queryGraph: (...args) => mockQueryGraph(...args),
  findRelated: jest.fn(async () => ({})),
  upsertNode: jest.fn(async () => ({})),
  createEdge: jest.fn(async () => ({})),
}));

const { handleKnowledgeGraphRoutes } = require('../../api/modules/agent-os/routes/knowledge-graph');

function buildCtx({ authPopulatesTenant }) {
  const sent = [];
  const req = { headers: {}, query: {} };
  return {
    sent,
    ctx: {
      req,
      res: {},
      method: 'GET',
      pathname: '/api/knowledge-graph',
      deps: {
        // Simula o requireAuth real (api/middleware/auth.js): muta req.
        requireAuth: jest.fn(() => {
          req.agent = { id: 'u1', username: 'systemadmin', role: 'super_admin' };
          if (authPopulatesTenant) req.tenantId = 'system';
          return { valid: true };
        }),
        requirePermission: jest.fn(() => ({ allowed: true })),
        sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
        badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
        hasJsonContentType: jest.fn(() => true),
        parseJsonBody: jest.fn(async () => ({})),
      },
    },
  };
}

describe('HARD-019 — resolução lazy de tenant nas rotas agent-os', () => {
  beforeEach(() => {
    mockQueryGraph.mockClear();
  });

  test('(a) requireAuth populando tenant no branch → service chamado com o tenant', async () => {
    const { ctx, sent } = buildCtx({ authPopulatesTenant: true });
    await handleKnowledgeGraphRoutes(ctx);
    // Nota: o branch GET não retorna true após sendJson (comportamento
    // pré-existente do handler) — o contrato observável é a chamada ao
    // service com o tenant e a resposta 200.
    expect(mockQueryGraph).toHaveBeenCalledTimes(1);
    expect(mockQueryGraph.mock.calls[0][0].tenantId).toBe('system');
    expect(sent[0].code).toBe(200);
  });

  test('(b) autenticado mas SEM tenant → 400 tenant_required, service não chamado', async () => {
    const { ctx, sent } = buildCtx({ authPopulatesTenant: false });
    const handled = await handleKnowledgeGraphRoutes(ctx);
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(400);
    expect(sent[0].data.error).toBe('tenant_required');
    expect(mockQueryGraph).not.toHaveBeenCalled();
  });
});
