'use strict';

/**
 * RecommendationEngine — outcome por sinal comportamental da ação executada.
 *
 * Além das métricas agregadas (baseline → snapshot), o outcome pode ser
 * medido no efeito real da ação: cliente respondeu após send_message?
 * tarefa criada por create_task/schedule foi concluída?
 * DB e serviços mockados (sem Postgres/Redis).
 */

function makeRow(json) {
  return {
    toJSON: () => json,
    update: jest.fn(async (changes) => {
      if (changes && typeof changes === 'object') Object.assign(json, changes);
    }),
  };
}

function loadEngine({ rowsById = {}, messages = [], tasksById = {}, snapshotsByKey = {}, messagesError = null, deps = {} } = {}) {
  jest.resetModules();

  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => ({
      findOne: jest.fn(async ({ where }) => rowsById[where.id] || null),
      findAll: jest.fn(async ({ where }) => Object.values(rowsById).filter((row) => {
        const json = row.toJSON();
        return (!where.status || json.status === where.status)
          && (!where.tenant_key || json.tenant_key === where.tenant_key);
      })),
    }),
    TenantInsight: () => ({ findOne: jest.fn(async () => null) }),
    TenantMetricSnapshot: () => ({
      findOne: jest.fn(async ({ where }) => snapshotsByKey[where.metric_key] || null),
    }),
    ChannelMessage: () => ({
      findAll: jest.fn(async () => {
        if (messagesError) throw messagesError;
        return messages;
      }),
    }),
    Task: () => ({
      findOne: jest.fn(async ({ where }) => tasksById[where.id] || null),
    }),
  }));

  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return {
    engine: new RecommendationEngine({
      evidenceEngine: { createEvidence: jest.fn(async () => ({})) },
      ...deps,
    }),
  };
}

function appliedRow(executedAction, overrides = {}) {
  const json = {
    id: 'reco-1',
    tenant_key: 'tenant-a',
    insight_id: 'ins-1',
    title: 'Retomar contato',
    description: 'Cliente parado.',
    priority: 'medium',
    status: 'applied',
    metadata: {
      application: {
        appliedAt: '2026-09-06T10:00:00.000Z',
        appliedBy: 'user-1',
        origin: 'manual',
        baseline: [],
        expectedDirection: 'observe',
        ...(executedAction ? { executedAction } : {}),
      },
    },
    ...overrides,
  };
  return makeRow(json);
}

describe('evaluateOutcome — sinal customer_reply (send_message)', () => {
  test('cliente respondeu após o envio → outcome improved + evidência registrada', async () => {
    const row = appliedRow({
      kind: 'send_message', status: 'executed', conversationId: 'conv-1',
      messageId: 'msg-1', executedAt: '2026-09-06T10:00:00.000Z',
    });
    const reply = { toJSON: () => ({ id: 'in-1', created_at: '2026-09-06T11:00:00.000Z' }) };
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [reply] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.reason).toBe('action_signal_positive');
    expect(result.outcome.actionSignals[0]).toMatchObject({ type: 'customer_reply', outcome: 'replied', replies: 1 });
    expect(row.toJSON().status).toBe('completed');
    expect(result.evidenceRecorded).toBe(true);
    expect(engine.evidenceEngine.createEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceType: 'outcome_evaluation', sourceId: 'reco-1' }),
    );
  });

  test('sem resposta dentro da janela de 24h → pending e recomendação segue applied', async () => {
    const row = appliedRow({
      kind: 'send_message', status: 'executed', conversationId: 'conv-1',
      messageId: 'msg-1', executedAt: new Date(Date.now() - 3600000).toISOString(),
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('awaiting_action_signal');
    expect(result.outcome.actionSignals[0].outcome).toBe('awaiting_reply');
    expect(row.toJSON().status).toBe('applied');
  });

  test('sem resposta após a janela → outcome unchanged (no_customer_reply)', async () => {
    const row = appliedRow({
      kind: 'send_message', status: 'executed', conversationId: 'conv-1',
      messageId: 'msg-1', executedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('unchanged');
    expect(result.outcome.reason).toBe('no_customer_reply');
    expect(row.toJSON().status).toBe('completed');
  });

  test('falha de leitura do sinal → unavailable explícito, comportamento legado preservado', async () => {
    const row = appliedRow({
      kind: 'send_message', status: 'executed', conversationId: 'conv-1',
      messageId: 'msg-1', executedAt: '2026-09-06T10:00:00.000Z',
    });
    const { engine } = loadEngine({
      rowsById: { 'reco-1': row },
      messagesError: Object.assign(new Error('db down'), { code: 'db_down' }),
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('no_baseline_metrics');
    expect(result.outcome.actionSignals[0].outcome).toBe('unavailable');
    expect(result.outcome.actionSignals[0].reason).toBe('db_down');
  });
});

describe('evaluateOutcome — sinal task_completion (create_task/schedule)', () => {
  test('tarefa concluída → outcome improved', async () => {
    const row = appliedRow({ kind: 'create_task', status: 'executed', taskId: 'task-1', executedAt: '2026-09-06T10:00:00.000Z' });
    const task = makeRow({ id: 'task-1', tenant_id: 'tenant-a', status: 'done' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, tasksById: { 'task-1': task } });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.actionSignals[0]).toMatchObject({ type: 'task_completion', outcome: 'done', status: 'done' });
  });

  test('tarefa aberta → pending awaiting_action_signal, segue applied', async () => {
    const row = appliedRow({ kind: 'schedule', status: 'executed', taskId: 'task-2', executedAt: '2026-09-06T10:00:00.000Z' });
    const task = makeRow({ id: 'task-2', tenant_id: 'tenant-a', status: 'open' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, tasksById: { 'task-2': task } });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('awaiting_action_signal');
    expect(row.toJSON().status).toBe('applied');
  });
});

describe('evaluateOutcome — métricas pendentes + sinal positivo', () => {
  test('snapshot ainda não chegou, mas cliente respondeu → sinal fecha outcome improved', async () => {
    const json = {
      id: 'reco-9',
      tenant_key: 'tenant-a',
      insight_id: null,
      title: 'Recuperar receita',
      description: '...',
      priority: 'high',
      status: 'applied',
      metadata: {
        application: {
          appliedAt: '2026-09-06T10:00:00.000Z',
          baseline: [{ metricKey: 'operations.tickets_open', value: 10, snapshotId: 'snap-old', capturedAt: '2026-09-06T10:00:00.000Z' }],
          expectedDirection: 'down',
          executedAction: {
            kind: 'send_message', status: 'executed', conversationId: 'conv-9',
            messageId: 'msg-9', executedAt: '2026-09-06T10:00:00.000Z',
          },
        },
      },
    };
    const row = makeRow(json);
    const reply = { toJSON: () => ({ id: 'in-9', created_at: '2026-09-06T12:00:00.000Z' }) };
    const { engine } = loadEngine({ rowsById: { 'reco-9': row }, messages: [reply] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-9' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.reason).toBe('action_signal_positive');
    expect(result.outcome.metrics[0].assessment).toBe('pending');
    expect(row.toJSON().status).toBe('completed');
  });
});

describe('evaluatePendingOutcomes — cobertura por sinal de ação', () => {
  test('applied sem baseline mas com ação executada é avaliada pelo sinal', async () => {
    const row = appliedRow({
      kind: 'send_message', status: 'executed', conversationId: 'conv-1',
      messageId: 'msg-1', executedAt: '2026-09-06T10:00:00.000Z',
    });
    const reply = { toJSON: () => ({ id: 'in-1', created_at: '2026-09-06T11:00:00.000Z' }) };
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [reply] });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result.total).toBe(1);
    expect(result.evaluated).toBe(1);
    expect(result.results[0].outcome).toBe('improved');
  });

  test('applied sem baseline e sem ação executada permanece pendente (inalterado)', async () => {
    const row = appliedRow(null);
    const { engine } = loadEngine({ rowsById: { 'reco-1': row } });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result.evaluated).toBe(0);
    expect(result.pending).toBe(1);
    expect(row.update).not.toHaveBeenCalled();
  });
});
