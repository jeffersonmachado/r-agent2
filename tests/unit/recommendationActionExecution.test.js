'use strict';

/**
 * RecommendationEngine — execução real de ações no apply.
 *
 * Cobre o dispatcher de action.kind (create_task, send_message, schedule),
 * os skips explícitos (dados insuficientes / kind desconhecido) e a guarda
 * de governança: ações customer-facing NUNCA executam em origem automática
 * (auto-apply dos níveis autonomous/exception_only).
 * DB e serviços mockados (sem Postgres/Redis/fila outbound).
 */

function makeRow(json) {
  return {
    toJSON: () => json,
    update: jest.fn(async (changes) => {
      if (changes && typeof changes === 'object') Object.assign(json, changes);
    }),
  };
}

function loadEngine({ rowsById = {}, deps = {} } = {}) {
  jest.resetModules();

  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => ({
      findOne: jest.fn(async ({ where }) => rowsById[where.id] || null),
      findAll: jest.fn(async () => []),
      create: jest.fn(async (data) => ({ toJSON: () => data })),
    }),
    TenantInsight: () => ({
      findOne: jest.fn(async () => null),
    }),
    TenantMetricSnapshot: () => ({
      findOne: jest.fn(async () => null),
    }),
  }));

  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return { engine: new RecommendationEngine(deps) };
}

function buildDeps(overrides = {}) {
  return {
    workspaceOperations: {
      createTask: jest.fn(async ({ payload }) => ({ id: 'task-1', ...payload })),
    },
    capabilitiesService: {
      getTenantCapabilities: jest.fn(async () => ({ autonomyLevel: 'suggest' })),
    },
    channelConversationService: {
      getConversation: jest.fn(async () => ({
        id: 'conv-1',
        tenantId: 'tenant-a',
        channelType: 'whatsapp',
        externalId: '+5511999990000',
        status: 'open',
      })),
      createMessage: jest.fn(async () => ({ id: 'msg-1' })),
      listConversations: jest.fn(async () => ({ total: 0, items: [] })),
      updateConversation: jest.fn(async ({ conversationId, patch }) => ({ id: conversationId, ...patch })),
    },
    outboundQueueService: {
      enqueueOutbound: jest.fn(async () => ({ id: 'out-1' })),
    },
    authService: {
      listAgents: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function buildRecommendationRow(action, overrides = {}) {
  const json = {
    id: 'reco-1',
    tenant_key: 'tenant-a',
    insight_id: null,
    title: 'Recuperar conversa parada',
    description: 'Cliente sem resposta ha 4 dias.',
    priority: 'medium',
    status: 'open',
    metadata: { action },
    ...overrides,
  };
  return makeRow(json);
}

describe('RecommendationEngine.applyRecommendation — send_message', () => {
  test('executa: persiste mensagem de saída e enfileira outbound com contexto', async () => {
    const deps = buildDeps();
    const row = buildRecommendationRow({
      kind: 'send_message',
      conversationId: 'conv-1',
      message: 'Oi! Podemos retomar seu agendamento?',
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(result.execution.status).toBe('executed');
    expect(result.execution.messageId).toBe('msg-1');
    expect(result.execution.conversationId).toBe('conv-1');

    expect(deps.channelConversationService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        conversationId: 'conv-1',
        channelType: 'whatsapp',
        direction: 'out',
        type: 'text',
        body: { text: 'Oi! Podemos retomar seu agendamento?' },
        status: 'pending',
      }),
    );
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        channelType: 'whatsapp',
        conversationId: 'conv-1',
        message: expect.objectContaining({
          to: '+5511999990000',
          type: 'text',
          meta: expect.objectContaining({ recommendationId: 'reco-1' }),
        }),
      }),
    );

    // execução fica registrada no metadata da recomendação aplicada
    const applied = result.recommendation;
    expect(applied.status).toBe('applied');
    expect(applied.metadata.application.executedAction.status).toBe('executed');
  });

  test('sem conversationId: skipped explícito e recomendação ainda aplicada', async () => {
    const deps = buildDeps();
    const row = buildRecommendationRow({ kind: 'send_message', message: 'texto' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('missing_conversation_id');
    expect(result.recommendation.status).toBe('applied');
    expect(deps.channelConversationService.createMessage).not.toHaveBeenCalled();
    expect(deps.outboundQueueService.enqueueOutbound).not.toHaveBeenCalled();
  });

  test('conversa inexistente: skipped conversation_not_found', async () => {
    const deps = buildDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(null);
    const row = buildRecommendationRow({
      kind: 'send_message',
      conversationId: 'conv-x',
      message: 'texto',
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('conversation_not_found');
  });

  test('origem auto: bloqueado com customer_facing_action_requires_human_apply', async () => {
    const deps = buildDeps();
    const row = buildRecommendationRow({
      kind: 'send_message',
      conversationId: 'conv-1',
      message: 'texto',
    });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    await expect(
      engine.applyRecommendation({
        tenantId: 'tenant-a',
        recommendationId: 'reco-1',
        actor: 'system',
        origin: 'auto',
      }),
    ).rejects.toMatchObject({ code: 'customer_facing_action_requires_human_apply', statusCode: 409 });

    // recomendação NÃO aplicada e nenhum efeito externo
    expect(row.update).not.toHaveBeenCalled();
    expect(deps.channelConversationService.createMessage).not.toHaveBeenCalled();
    expect(deps.outboundQueueService.enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe('RecommendationEngine.applyRecommendation — schedule e fallback', () => {
  test('schedule: cria tarefa followup com dueDate', async () => {
    const deps = buildDeps();
    const row = buildRecommendationRow({ kind: 'schedule', dueDate: '2026-09-10T14:00:00.000Z' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('executed');
    expect(result.execution.kind).toBe('schedule');
    expect(result.execution.taskId).toBe('task-1');
    expect(deps.workspaceOperations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        payload: expect.objectContaining({ type: 'followup', dueDate: '2026-09-10T14:00:00.000Z' }),
      }),
    );
  });

  test('kind desconhecido: skipped unsupported_action_kind, apply segue', async () => {
    const deps = buildDeps();
    const row = buildRecommendationRow({ kind: 'retroactive_recalc' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('unsupported_action_kind');
    expect(result.recommendation.status).toBe('applied');
  });
});

describe('RecommendationEngine._maybeAutoApply — guarda customer-facing', () => {
  test('autonomous: aplica create_task, pula send_message (fica aberta p/ humano)', async () => {
    const deps = buildDeps();
    deps.capabilitiesService.getTenantCapabilities.mockResolvedValue({ autonomyLevel: 'autonomous' });

    const taskRow = buildRecommendationRow({ kind: 'create_task' }, { id: 'reco-task' });
    const msgRow = buildRecommendationRow(
      { kind: 'send_message', conversationId: 'conv-1', message: 'texto' },
      { id: 'reco-msg' },
    );
    const { engine } = loadEngine({
      rowsById: { 'reco-task': taskRow, 'reco-msg': msgRow },
      deps,
    });

    const result = await engine._maybeAutoApply({
      tenantId: 'tenant-a',
      created: [
        { id: 'reco-task', priority: 'medium', metadata: { action: { kind: 'create_task' } } },
        { id: 'reco-msg', priority: 'medium', metadata: { action: { kind: 'send_message' } } },
      ],
    });

    expect(result.attempted).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skippedCustomerFacing).toBe(1);

    expect(taskRow.toJSON().status).toBe('applied');
    expect(msgRow.update).not.toHaveBeenCalled();
    expect(deps.channelConversationService.createMessage).not.toHaveBeenCalled();
  });

  test('autonomous: rebalance_queue é ação interna e auto-aplica (sem guarda customer-facing)', async () => {
    const deps = buildDeps();
    deps.capabilitiesService.getTenantCapabilities.mockResolvedValue({ autonomyLevel: 'autonomous' });
    deps.authService.listAgents.mockResolvedValue([
      { id: 'ag-1', role: 'operator', active: true },
      { id: 'ag-2', role: 'operator', active: true },
    ]);
    deps.channelConversationService.listConversations.mockResolvedValue({
      total: 3,
      items: [
        { id: 'c1', assignedTo: 'ag-1' },
        { id: 'c2', assignedTo: 'ag-1' },
        { id: 'c3', assignedTo: 'ag-1' },
      ],
    });

    const rebalanceRow = buildRecommendationRow(
      { kind: 'rebalance_queue', label: 'Redistribuir conversas abertas' },
      { id: 'reco-reb' },
    );
    const { engine } = loadEngine({ rowsById: { 'reco-reb': rebalanceRow }, deps });

    const result = await engine._maybeAutoApply({
      tenantId: 'tenant-a',
      created: [{ id: 'reco-reb', priority: 'high', metadata: { action: { kind: 'rebalance_queue' } } }],
    });

    expect(result.attempted).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.skippedCustomerFacing).toBeUndefined();
    expect(rebalanceRow.toJSON().status).toBe('applied');
  });
});

describe('RecommendationEngine.applyRecommendation — rebalance_queue', () => {
  function rebalanceDeps({ conversations, agents }) {
    const deps = buildDeps();
    deps.channelConversationService.listConversations.mockResolvedValue({
      total: conversations.length,
      items: conversations,
    });
    deps.authService.listAgents.mockResolvedValue(agents);
    return deps;
  }

  const twoAgents = [
    { id: 'ag-1', role: 'operator', active: true },
    { id: 'ag-2', role: 'operator', active: true },
  ];

  test('executa: atribui sem dono e move do mais carregado para o menos carregado', async () => {
    const deps = rebalanceDeps({
      agents: twoAgents,
      conversations: [
        { id: 'c1', assignedTo: 'ag-1' },
        { id: 'c2', assignedTo: 'ag-1' },
        { id: 'c3', assignedTo: 'ag-1' },
        { id: 'c4', assignedTo: null },
      ],
    });
    const row = buildRecommendationRow({ kind: 'rebalance_queue', label: 'Redistribuir conversas abertas' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(result.execution.status).toBe('executed');
    // c4 sem dono → ag-2; depois ag-1 (3) vs ag-2 (1) → move 1 de ag-1 para ag-2
    expect(result.execution.assigned).toBe(1);
    expect(result.execution.rebalanced).toBe(1);
    expect(result.execution.distribution).toEqual({ 'ag-1': 2, 'ag-2': 2 });
    expect(deps.channelConversationService.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c4', patch: { assigned_to: 'ag-2' } }),
    );
    expect(result.recommendation.metadata.application.executedAction.kind).toBe('rebalance_queue');
  });

  test('fila já equilibrada: skipped already_balanced, nenhuma conversa movida', async () => {
    const deps = rebalanceDeps({
      agents: twoAgents,
      conversations: [
        { id: 'c1', assignedTo: 'ag-1' },
        { id: 'c2', assignedTo: 'ag-2' },
      ],
    });
    const row = buildRecommendationRow({ kind: 'rebalance_queue' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('already_balanced');
    expect(deps.channelConversationService.updateConversation).not.toHaveBeenCalled();
  });

  test('menos de 2 conversas abertas: skipped not_enough_open_conversations', async () => {
    const deps = rebalanceDeps({
      agents: twoAgents,
      conversations: [{ id: 'c1', assignedTo: null }],
    });
    const row = buildRecommendationRow({ kind: 'rebalance_queue' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('not_enough_open_conversations');
  });

  test('sem atendentes elegíveis: skipped no_eligible_agents', async () => {
    const deps = rebalanceDeps({
      agents: [{ id: 'ag-9', role: 'auditor', active: true }],
      conversations: [{ id: 'c1', assignedTo: null }, { id: 'c2', assignedTo: null }],
    });
    const row = buildRecommendationRow({ kind: 'rebalance_queue' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('skipped');
    expect(result.execution.reason).toBe('no_eligible_agents');
  });

  test('falha total nos updates: status failed explícito', async () => {
    const deps = rebalanceDeps({
      agents: twoAgents,
      conversations: [{ id: 'c1', assignedTo: null }, { id: 'c2', assignedTo: null }],
    });
    deps.channelConversationService.updateConversation.mockRejectedValue(new Error('db down'));
    const row = buildRecommendationRow({ kind: 'rebalance_queue' });
    const { engine } = loadEngine({ rowsById: { 'reco-1': row }, deps });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'user-1',
      origin: 'manual',
    });

    expect(result.execution.status).toBe('failed');
    expect(result.execution.error).toBe('all_moves_failed');
  });
});

describe('RecommendationEngine._mapInsightToRecommendation — causa de primeira resposta', () => {
  function insightWithCause(direction) {
    return {
      id: 'insight-1',
      type: 'metric_drop',
      related_metrics: ['sales.conversion_rate'],
      metadata: {
        probableCauses: [{
          metricKey: 'operations.avg_first_response_minutes',
          label: 'tempo médio de primeira resposta',
          changeRatio: 0.42,
          direction,
        }],
      },
    };
  }

  test('causa = primeira resposta em alta → ação executável rebalance_queue', () => {
    const { engine } = loadEngine({ deps: buildDeps() });

    const mapped = engine._mapInsightToRecommendation(insightWithCause('up'), []);

    expect(mapped.actionType).toBe('rebalance_queue');
    expect(mapped.action.kind).toBe('rebalance_queue');
    expect(mapped.priority).toBe('high');
    expect(mapped.title).toContain('primeira resposta');
  });

  test('causa em queda (direction down) NÃO ativa rebalance → mantém investigação', () => {
    const { engine } = loadEngine({ deps: buildDeps() });

    const mapped = engine._mapInsightToRecommendation(insightWithCause('down'), []);

    expect(mapped.actionType).toBe('investigate_metric_drop');
    expect(mapped.action.kind).toBe('create_task');
  });

  test('goal_at_risk com causa de primeira resposta também ganha rebalance', () => {
    const { engine } = loadEngine({ deps: buildDeps() });
    const insight = { ...insightWithCause('up'), type: 'goal_at_risk' };

    const mapped = engine._mapInsightToRecommendation(insight, []);

    expect(mapped.actionType).toBe('rebalance_queue');
    expect(mapped.action.kind).toBe('rebalance_queue');
  });

  test('metric_drop sem causas prováveis mantém mapeamento de investigação', () => {
    const { engine } = loadEngine({ deps: buildDeps() });
    const insight = {
      id: 'insight-2',
      type: 'metric_drop',
      related_metrics: ['sales.conversion_rate'],
      metadata: {},
    };

    const mapped = engine._mapInsightToRecommendation(insight, []);

    expect(mapped.actionType).toBe('investigate_metric_drop');
    expect(mapped.action.kind).toBe('create_task');
  });
});
