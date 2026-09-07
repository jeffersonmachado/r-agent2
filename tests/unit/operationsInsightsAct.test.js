'use strict';

/**
 * P1.3 — Decision Intelligence no Operations Dashboard:
 * insight vertical vira recomendação real (POST /insights/act).
 * Serviço (mapping, prioridade, dedupe) + router express (201/200/422).
 */

jest.mock('../../api/services/operations/actOnOperationsInsight', () => ({
  actOnOperationsInsight: jest.fn(),
  INSIGHT_ACTION_MAP: {},
  insightKey: jest.fn(),
}));

jest.mock('../../api/services/operationsDashboardService', () => ({
  computeSummary: jest.fn(),
  listTimeline: jest.fn(),
  listJobs: jest.fn(),
  listNotifications: jest.fn(),
  listInsights: jest.fn(),
}));

jest.mock('../../api/services/superAdminService', () => ({
  isSuperAdmin: jest.fn(() => false),
}));

jest.mock('../../api/core/tenant-intelligence/RecommendationEngine', () => ({
  RecommendationEngine: jest.fn(function RecommendationEngine() { return {}; }),
}));

// Serviço real (sem o mock acima) para os testes de unidade do mapping.
const { actOnOperationsInsight: realAct } = jest.requireActual('../../api/services/operations/actOnOperationsInsight');
const { actOnOperationsInsight } = require('../../api/services/operations/actOnOperationsInsight');
const { createOperationsDashboardRoutes } = require('../../api/modules/operations-dashboard/routes');

describe('actOnOperationsInsight — serviço', () => {
  function engineMock({ openItems = [] } = {}) {
    return {
      listRecommendations: jest.fn(async () => ({ items: openItems, total: openItems.length })),
      createRecommendation: jest.fn(async ({ payload }) => ({ id: 'reco-new', ...payload })),
    };
  }

  test('no_show_risk com score alto → no_show_recovery, prioridade high, ação create_task', async () => {
    const engine = engineMock();
    const out = await realAct({
      tenantId: 'tenant-a',
      insight: {
        vertical: 'beauty', type: 'no_show_risk', subjectId: 'sub-1',
        score: 0.82, reason: 'High no-show risk', action: 'send_confirmation_reminder',
      },
      recommendationEngine: engine,
    });

    expect(out.ok).toBe(true);
    expect(out.deduplicated).toBe(false);
    const payload = engine.createRecommendation.mock.calls[0][0].payload;
    expect(payload.actionType).toBe('no_show_recovery');
    expect(payload.priority).toBe('high');
    expect(payload.action).toEqual({ kind: 'create_task', label: 'Criar tarefa operacional' });
    expect(payload.metadata.verticalInsight).toMatchObject({
      key: 'beauty:no_show_risk:sub-1', type: 'no_show_risk', score: 0.82,
    });
    expect(payload.description).toContain('send_confirmation_reminder');
  });

  test('score abaixo do limiar → prioridade medium', async () => {
    const engine = engineMock();
    await realAct({
      tenantId: 'tenant-a',
      insight: { vertical: 'fitness', type: 'churn_risk', subjectId: 'stu-9', score: 0.41, reason: 'Churn risk' },
      recommendationEngine: engine,
    });

    expect(engine.createRecommendation.mock.calls[0][0].payload.priority).toBe('medium');
  });

  test('dedupe: já existe aberta com a mesma chave → deduplicated, sem criar', async () => {
    const existing = {
      id: 'reco-existing',
      status: 'open',
      metadata: { verticalInsight: { key: 'beauty:no_show_risk:sub-1' } },
    };
    const engine = engineMock({ openItems: [existing] });

    const out = await realAct({
      tenantId: 'tenant-a',
      insight: { vertical: 'beauty', type: 'no_show_risk', subjectId: 'sub-1', score: 0.9 },
      recommendationEngine: engine,
    });

    expect(out.deduplicated).toBe(true);
    expect(out.recommendation.id).toBe('reco-existing');
    expect(engine.createRecommendation).not.toHaveBeenCalled();
  });

  test('tipo sem mapeamento → erro unsupported_insight_type', async () => {
    const engine = engineMock();
    await expect(realAct({
      tenantId: 'tenant-a',
      insight: { type: 'unknown_thing' },
      recommendationEngine: engine,
    })).rejects.toMatchObject({ code: 'unsupported_insight_type' });
    expect(engine.createRecommendation).not.toHaveBeenCalled();
  });
});

describe('POST /api/operations-dashboard/insights/act — router', () => {
  function buildDepsMock(tenantId = 'tenant-a') {
    return jest.fn(() => ({
      requireAuth: jest.fn(() => ({ valid: true, agent: { id: 'agent-1', role: 'admin', tenantId } })),
      requireTenant: jest.fn(() => tenantId),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
  }

  function invoke(router, { method = 'POST', url = '/api/operations-dashboard/insights/act', body = {}, tenantId = 'tenant-a' }) {
    return new Promise((resolve, reject) => {
      const req = {
        method,
        url,
        originalUrl: url,
        body,
        headers: { 'content-type': 'application/json' },
        agent: { id: 'agent-1', role: 'admin', tenantId },
        tenantId,
      };
      const res = {
        statusCode: null,
        payload: null,
        setHeader: jest.fn(),
        getHeader: jest.fn(),
        end: jest.fn(),
      };
      const origSendJson = null;
      router.handle(req, res, (err) => (err ? reject(err) : resolve({ res, nextCalled: true })));
      // sendJson é mockado por teste; resolvemos quando ele for chamado.
      setImmediate(() => resolve({ res, nextCalled: false, origSendJson }));
    });
  }

  test('201 na criação; 200 quando deduplicado; 422 tipo sem mapeamento', async () => {
    const deps = buildDepsMock();
    const captured = [];
    const depsFn = jest.fn(() => {
      const d = deps();
      d.sendJson = jest.fn((res, status, body) => { captured.push({ status, body }); });
      return d;
    });
    const router = createOperationsDashboardRoutes({ buildDeps: depsFn });

    // criação
    actOnOperationsInsight.mockResolvedValueOnce({ ok: true, deduplicated: false, recommendation: { id: 'reco-1' } });
    await invoke(router, { body: { vertical: 'beauty', type: 'no_show_risk', subjectId: 'sub-1', score: 0.82 } });
    await new Promise((r) => setImmediate(r));
    expect(captured[0].status).toBe(201);
    expect(captured[0].body.ok).toBe(true);

    // dedupe → 200
    actOnOperationsInsight.mockResolvedValueOnce({ ok: true, deduplicated: true, recommendation: { id: 'reco-1' } });
    await invoke(router, { body: { vertical: 'beauty', type: 'no_show_risk', subjectId: 'sub-1', score: 0.82 } });
    await new Promise((r) => setImmediate(r));
    expect(captured[1].status).toBe(200);

    // tipo sem mapeamento → 422
    actOnOperationsInsight.mockRejectedValueOnce(Object.assign(new Error('unsupported_insight_type'), { code: 'unsupported_insight_type' }));
    await invoke(router, { body: { type: 'unknown_thing' } });
    await new Promise((r) => setImmediate(r));
    expect(captured[2].status).toBe(422);
    expect(captured[2].body.error).toBe('unsupported_insight_type');
  });
});
