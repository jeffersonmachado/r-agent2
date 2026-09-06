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
    },
    outboundQueueService: {
      enqueueOutbound: jest.fn(async () => ({ id: 'out-1' })),
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
});
