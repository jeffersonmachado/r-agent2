'use strict';

/**
 * RecommendationEngine — outcome por sinal comportamental da ação executada.
 *
 * Além das métricas agregadas (baseline → snapshot), o outcome pode ser
 * medido no efeito real da ação: cliente respondeu após send_message?
 * tarefa criada por create_task/schedule foi concluída? a equipe respondeu
 * nas conversas movidas pelo rebalance_queue?
 * Inclui o learn de 2º nível: rebalance sem resposta da equipe
 * (no_agent_response) gera recomendação seguinte causal (escalonamento ao
 * gestor ou reforço de equipe), com guardas anti-loop.
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

function loadEngine({
  rowsById = {},
  messages = [],
  tasksById = {},
  snapshotsByKey = {},
  messagesError = null,
  openConversationIds = [],
  conversationsError = null,
  agents = [],
  agentsError = null,
  createError = null,
  deps = {},
} = {}) {
  jest.resetModules();

  const createMock = jest.fn(async (data) => {
    if (createError) throw createError;
    return makeRow({ ...data });
  });
  const conversationsFindAllMock = jest.fn(async () => {
    if (conversationsError) throw conversationsError;
    return openConversationIds.map((id) => makeRow({ id }));
  });

  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => ({
      create: createMock,
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
    ChannelConversation: () => ({ findAll: conversationsFindAllMock }),
    Task: () => ({
      findOne: jest.fn(async ({ where }) => tasksById[where.id] || null),
    }),
  }));

  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return {
    engine: new RecommendationEngine({
      evidenceEngine: { createEvidence: jest.fn(async () => ({})) },
      authService: {
        listAgents: jest.fn(async () => {
          if (agentsError) throw agentsError;
          return agents;
        }),
      },
      ...deps,
    }),
    mocks: { create: createMock, conversationsFindAll: conversationsFindAllMock },
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

describe('evaluateOutcome — sinal rebalance_response (rebalance_queue)', () => {
  function rebalanceRow(executedAt) {
    return appliedRow({
      kind: 'rebalance_queue',
      status: 'executed',
      assigned: 1,
      rebalanced: 1,
      agents: 2,
      conversationIds: ['conv-a', 'conv-b'],
      executedAt,
    });
  }

  test('equipe respondeu em conversa movida → outcome improved + evidência', async () => {
    const row = rebalanceRow('2026-09-06T10:00:00.000Z');
    const reply = { toJSON: () => ({ id: 'out-1', conversation_id: 'conv-b', created_at: '2026-09-06T11:00:00.000Z' }) };
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [reply] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.reason).toBe('action_signal_positive');
    expect(result.outcome.actionSignals[0]).toMatchObject({
      type: 'rebalance_response',
      outcome: 'handled',
      handledConversations: 1,
      totalConversations: 2,
    });
    expect(row.toJSON().status).toBe('completed');
    expect(result.evidenceRecorded).toBe(true);
  });

  test('sem resposta da equipe dentro da janela → pending, segue applied', async () => {
    const row = rebalanceRow(new Date(Date.now() - 3600000).toISOString());
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('awaiting_action_signal');
    expect(result.outcome.actionSignals[0].outcome).toBe('awaiting_handling');
    expect(row.toJSON().status).toBe('applied');
  });

  test('sem resposta da equipe após a janela → unchanged (no_agent_response)', async () => {
    const row = rebalanceRow(new Date(Date.now() - 48 * 3600000).toISOString());
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, messages: [] });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('unchanged');
    expect(result.outcome.reason).toBe('no_agent_response');
    expect(row.toJSON().status).toBe('completed');
  });

  test('executed sem conversationIds → nenhum sinal de rebalance (comportamento legado)', async () => {
    const row = appliedRow({
      kind: 'rebalance_queue', status: 'executed', assigned: 0, rebalanced: 0,
      executedAt: '2026-09-06T10:00:00.000Z',
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row } });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('no_baseline_metrics');
    expect(result.outcome.actionSignals).toBeUndefined();
  });

  test('falha de leitura → unavailable explícito, outcome segue regra legada', async () => {
    const row = rebalanceRow('2026-09-06T10:00:00.000Z');
    const { engine } = loadEngine({
      rowsById: { 'reco-1': row },
      messagesError: Object.assign(new Error('db down'), { code: 'db_down' }),
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.actionSignals[0].outcome).toBe('unavailable');
    expect(result.outcome.actionSignals[0].reason).toBe('db_down');
  });
});

describe('evaluateOutcome — follow-up de 2º nível (no_agent_response)', () => {
  const AGENTS_2 = [
    { id: 'ag-1', role: 'operator', active: true },
    { id: 'ag-2', role: 'manager', active: true },
  ];

  function staleRebalanceRow(overrides = {}) {
    return appliedRow({
      kind: 'rebalance_queue',
      status: 'executed',
      assigned: 1,
      rebalanced: 1,
      agents: 2,
      conversationIds: ['conv-a', 'conv-b'],
      executedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    }, overrides);
  }

  test('equipe existe → follow-up manager_escalation criado e pai marcado', async () => {
    const row = staleRebalanceRow();
    const { engine, mocks } = loadEngine({
      rowsById: { 'reco-1': row },
      messages: [],
      agents: AGENTS_2,
      openConversationIds: ['conv-a'],
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('unchanged');
    expect(result.outcome.reason).toBe('no_agent_response');
    expect(result.followUp).toMatchObject({ created: true, variant: 'manager_escalation' });
    expect(result.followUp.diagnosis).toMatchObject({ eligibleAgents: 2, stillOpen: 1, totalMoved: 2 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const payload = mocks.create.mock.calls[0][0];
    expect(payload.action_type).toBe('manager_escalation');
    expect(payload.priority).toBe('high');
    expect(payload.metadata.followUpOf).toBe('reco-1');
    expect(payload.metadata.followUpDepth).toBe(1);
    expect(payload.metadata.followUpReason).toBe('no_agent_response');
    expect(payload.metadata.action).toMatchObject({ kind: 'create_task' });
    expect(payload.description).toContain('gestor');
    expect(row.toJSON().metadata.followUp).toMatchObject({
      reason: 'no_agent_response',
      variant: 'manager_escalation',
    });
  });

  test('apenas 1 operador ativo → follow-up staffing_review', async () => {
    const row = staleRebalanceRow();
    const { engine, mocks } = loadEngine({
      rowsById: { 'reco-1': row },
      messages: [],
      agents: [{ id: 'ag-1', role: 'operator', active: true }],
      openConversationIds: ['conv-a', 'conv-b'],
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.followUp).toMatchObject({ created: true, variant: 'staffing_review' });
    const payload = mocks.create.mock.calls[0][0];
    expect(payload.action_type).toBe('staffing_review');
    expect(payload.description).toContain('reforço de equipe');
  });

  test('super_admin não conta como operador elegível no diagnóstico', async () => {
    const row = staleRebalanceRow();
    const { engine } = loadEngine({
      rowsById: { 'reco-1': row },
      messages: [],
      agents: [{ id: 'root', role: 'super_admin', active: true }],
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.followUp).toMatchObject({ created: true, variant: 'staffing_review' });
    expect(result.followUp.diagnosis.eligibleAgents).toBe(0);
  });

  test('idempotente: metadata.followUp já presente → nenhum follow-up novo', async () => {
    const row = staleRebalanceRow();
    row.toJSON().metadata.followUp = {
      createdRecommendationId: 'reco-old', createdAt: '2026-09-06T12:00:00.000Z', reason: 'no_agent_response', variant: 'manager_escalation',
    };
    const { engine, mocks } = loadEngine({ rowsById: { 'reco-1': row }, messages: [], agents: AGENTS_2 });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.reason).toBe('no_agent_response');
    expect(result.followUp).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test('anti-loop: followUpDepth >= 1 nunca gera follow-up de 3º nível', async () => {
    const row = staleRebalanceRow();
    row.toJSON().metadata.followUpDepth = 1;
    const { engine, mocks } = loadEngine({ rowsById: { 'reco-1': row }, messages: [], agents: AGENTS_2 });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.followUp).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test('outcome improved (equipe respondeu) → nenhum follow-up', async () => {
    const row = staleRebalanceRow();
    const reply = { toJSON: () => ({ id: 'out-1', conversation_id: 'conv-a', created_at: new Date().toISOString() }) };
    const { engine, mocks } = loadEngine({ rowsById: { 'reco-1': row }, messages: [reply], agents: AGENTS_2 });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.followUp).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test('diagnóstico fail-soft: listAgents fora do ar → follow-up ainda é criado (variant default)', async () => {
    const row = staleRebalanceRow();
    const { engine } = loadEngine({
      rowsById: { 'reco-1': row },
      messages: [],
      agentsError: Object.assign(new Error('auth down'), { code: 'auth_down' }),
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.followUp).toMatchObject({ created: true, variant: 'manager_escalation' });
    expect(result.followUp.diagnosis.eligibleAgents).toBeNull();
    expect(result.followUp.diagnosis.agentsError).toBe('auth_down');
  });

  test('falha ao criar follow-up não derruba a avaliação', async () => {
    const row = staleRebalanceRow();
    const { engine } = loadEngine({
      rowsById: { 'reco-1': row },
      messages: [],
      agents: AGENTS_2,
      createError: Object.assign(new Error('insert failed'), { code: 'insert_failed' }),
    });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.ok).toBe(true);
    expect(result.outcome.outcome).toBe('unchanged');
    expect(result.followUp).toMatchObject({ created: false, error: 'insert_failed' });
    expect(row.toJSON().metadata.followUp).toBeUndefined();
  });
});
