/**
 * Testes unitários: Cognitive Core — Action Planner, Execution Engine,
 * Validation Engine, Learning Engine e Cognitive Orchestrator (pipeline completo),
 * incluindo isolamento multi-tenant e política de visibilidade.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const { createActionPlanner, PLAN_TEMPLATES } = require('../../src/core/cognitive/action-planner');
const { createExecutionEngine } = require('../../src/core/cognitive/execution-engine');
const { createValidationEngine } = require('../../src/core/cognitive/validation-engine');
const { createLearningEngine } = require('../../src/core/cognitive/learning-engine');
const { createCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');
const { createContextEngine } = require('../../src/core/cognitive/context-engine');

const ACTOR = { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] };

function buildStubRegistry({ onExecute } = {}) {
  const registry = createToolRegistry();
  const toolIds = [
    'searchCustomer', 'createLead', 'updateLead', 'createOpportunity',
    'createAppointment', 'rescheduleAppointment', 'cancelAppointment',
    'sendWhatsappMessage', 'createTicket', 'transferConversation',
    'originateCall', 'createCampaign', 'generateInsight',
  ];
  for (const id of toolIds) {
    registry.register({
      id,
      visibility: 'PRODUCTION',
      permissions: [],
      description: `stub ${id}`,
      execute: jest.fn(async (input, context) => {
        if (onExecute) return onExecute(id, input, context);
        return { ok: true, toolId: id, tenantId: context.tenantId };
      }),
    });
  }
  return registry;
}

function buildStubContextEngine() {
  return {
    buildContext: jest.fn(async ({ tenantId, channel }) => ({
      tenantId,
      channel,
      customer: null,
      conversation: null,
      crm: null,
      appointments: [],
      tickets: [],
      campaigns: [],
      metrics: null,
      trace: [],
      builtAt: new Date().toISOString(),
    })),
  };
}

// Double do provider de IA: classifica as mensagens fixas dos testes dentro
// da taxonomia (o Intent Engine é AI-first; não há mais classificação por
// regras/keywords no caminho de produção).
const TEST_INTENT_BY_MESSAGE = [
  [/remarcar/i, 'remarcar_agendamento'],
  [/cancelar/i, 'cancelar_agendamento'],
  [/abrir um chamado/i, 'abrir_ticket'],
];

function buildStubGenerateAiResponse() {
  return jest.fn(async (prompt) => {
    const message = String(prompt).split('Mensagem: ')[1] || '';
    const match = TEST_INTENT_BY_MESSAGE.find(([pattern]) => pattern.test(message));
    if (!match) return { text: '{"intent":"transferir_humano","confidence":0.2}' };
    return { text: JSON.stringify({ intent: match[1], confidence: 0.9 }) };
  });
}

function buildOrchestrator(overrides = {}) {
  const registry = overrides.toolRegistry || buildStubRegistry(overrides);
  const learningRecords = [];
  const orchestrator = createCognitiveOrchestrator({
    toolRegistry: registry,
    contextEngine: overrides.contextEngine || buildStubContextEngine(),
    learningEngine: overrides.learningEngine || {
      record: jest.fn(async (record) => { learningRecords.push(record); return { recorded: true }; }),
    },
    generateAiResponse: overrides.generateAiResponse || buildStubGenerateAiResponse(),
    ...overrides.extra,
  });
  return { orchestrator, registry, learningRecords };
}

describe('Cognitive Core — Action Planner', () => {
  const registry = buildStubRegistry();
  const planner = createActionPlanner({ toolRegistry: registry });
  const context = { tenantId: 't1' };

  test('gera plano determinístico para remarcar_agendamento na sequência esperada', () => {
    const plan = planner.plan({ intent: 'remarcar_agendamento', context, actor: ACTOR });
    expect(plan.steps.map((s) => s.id)).toEqual([
      'find_customer', 'find_current_appointment', 'check_availability',
      'reschedule_appointment', 'notify_professional', 'send_confirmation',
    ]);
    expect(plan.deterministic).toBe(true);
    expect(plan.planId).toBeTruthy();
    expect(plan.tenantId).toBe('t1');
  });

  test('exige tenant e intent conhecido', () => {
    expect(() => planner.plan({ intent: 'agendar', context: {}, actor: ACTOR })).toThrow('cognitive_planner_tenant_required');
    expect(() => planner.plan({ intent: 'destruir_tudo', context, actor: ACTOR })).toThrow('cognitive_planner_unknown_intent');
  });

  test('ação crítica sem confirmação marca requiresConfirmation', () => {
    const plan = planner.plan({ intent: 'cancelar_agendamento', context, actor: ACTOR, payload: {} });
    const critical = plan.steps.find((s) => s.id === 'cancel_appointment');
    expect(critical.critical).toBe(true);
    expect(critical.requiresConfirmation).toBe(true);
    expect(plan.requiresConfirmation).toBe(true);

    const confirmedPlan = planner.plan({ intent: 'cancelar_agendamento', context, actor: ACTOR, payload: { confirmed: true } });
    expect(confirmedPlan.requiresConfirmation).toBe(false);
  });

  test('ator sem permissão tem passos negados e plano sem passos executáveis falha', () => {
    const guarded = createToolRegistry();
    guarded.register({
      id: 'transferConversation',
      visibility: 'PRODUCTION',
      permissions: ['conversation.transfer'],
      description: 'stub',
      execute: async () => ({}),
    });
    const guardedPlanner = createActionPlanner({ toolRegistry: guarded });
    expect(() => guardedPlanner.plan({
      intent: 'transferir_humano',
      context,
      actor: { classification: 'PRODUCTION', permissions: [] },
    })).toThrow('cognitive_planner_no_executable_steps');
  });

  test('todas as 11 intenções têm template de plano', () => {
    expect(Object.keys(PLAN_TEMPLATES).sort()).toEqual([
      'abrir_ticket', 'agendar', 'cancelar_agendamento', 'consultar_metricas',
      'consultar_status', 'criar_lead', 'enviar_proposta', 'iniciar_campanha',
      'qualificar_lead', 'remarcar_agendamento', 'transferir_humano',
    ]);
  });
});

describe('Cognitive Core — Execution Engine', () => {
  test('executa plano completo registrando entradas/saídas sanitizadas', async () => {
    const registry = buildStubRegistry();
    const planner = createActionPlanner({ toolRegistry: registry });
    const engine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'criar_lead', context: { tenantId: 't1' }, actor: ACTOR });

    const result = await engine.execute({
      plan,
      context: { tenantId: 't1' },
      actor: ACTOR,
      input: { create_lead: { name: 'Maria', password: 'super-secreta' } },
    });

    expect(result.status).toBe('completed');
    expect(result.toolsExecuted).toEqual(['searchCustomer', 'createLead']);
    const createStep = result.steps.find((s) => s.id === 'create_lead');
    expect(createStep.input.password).toBe('[redacted]');
  });

  test('interrompe em passo crítico sem confirmação', async () => {
    const registry = buildStubRegistry();
    const planner = createActionPlanner({ toolRegistry: registry });
    const engine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'cancelar_agendamento', context: { tenantId: 't1' }, actor: ACTOR, payload: {} });

    const result = await engine.execute({ plan, context: { tenantId: 't1' }, actor: ACTOR });
    expect(result.status).toBe('halted_awaiting_confirmation');
    expect(result.toolsExecuted).not.toContain('cancelAppointment');
  });

  test('erro crítico interrompe e executa rollback dos passos suportados', async () => {
    const registry = createToolRegistry();
    const rollbackSpy = jest.fn(async () => {});
    registry.register({
      id: 'searchCustomer',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'stub',
      execute: async () => ({ found: true }),
      rollback: rollbackSpy,
    });
    registry.register({
      id: 'createLead',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'stub',
      execute: async () => { throw new Error('db down'); },
    });
    const planner = createActionPlanner({ toolRegistry: registry });
    const engine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'criar_lead', context: { tenantId: 't1' }, actor: ACTOR });

    const result = await engine.execute({ plan, context: { tenantId: 't1' }, actor: ACTOR });
    expect(result.status).toBe('failed');
    expect(result.failure.step).toBe('create_lead');
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    const searchStep = result.steps.find((s) => s.id === 'find_customer');
    expect(searchStep.rollback).toBe('done');
  });

  test('falha em passo opcional não interrompe o plano', async () => {
    const registry = buildStubRegistry({
      onExecute: (id) => {
        if (id === 'sendWhatsappMessage') throw new Error('whatsapp indisponível');
        return { ok: true };
      },
    });
    const planner = createActionPlanner({ toolRegistry: registry });
    const engine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'agendar', context: { tenantId: 't1' }, actor: ACTOR });

    const result = await engine.execute({ plan, context: { tenantId: 't1' }, actor: ACTOR });
    expect(result.status).toBe('completed');
    expect(result.toolsExecuted).toContain('createAppointment');
  });

  test('rejeita execução com tenant divergente do plano', async () => {
    const registry = buildStubRegistry();
    const planner = createActionPlanner({ toolRegistry: registry });
    const engine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'criar_lead', context: { tenantId: 'tenant-a' }, actor: ACTOR });
    await expect(engine.execute({ plan, context: { tenantId: 'tenant-b' }, actor: ACTOR }))
      .rejects.toThrow('cognitive_execution_tenant_mismatch');
  });
});

describe('Cognitive Core — Validation Engine', () => {
  const engine = createValidationEngine();

  test('valida execução completa consistente', async () => {
    const registry = buildStubRegistry();
    const planner = createActionPlanner({ toolRegistry: registry });
    const executionEngine = createExecutionEngine({ toolRegistry: registry });
    const plan = planner.plan({ intent: 'abrir_ticket', context: { tenantId: 't1' }, actor: ACTOR });
    const execution = await executionEngine.execute({ plan, context: { tenantId: 't1' }, actor: ACTOR });

    const result = engine.validate({ plan, execution, context: { tenantId: 't1' } });
    expect(result.valid).toBe(true);
    expect(result.checks.find((c) => c.name === 'tenant_consistency').passed).toBe(true);
    expect(result.checks.find((c) => c.name === 'audit_trail_complete').passed).toBe(true);
  });

  test('detecta inconsistência de tenant', () => {
    const plan = { planId: 'p1', tenantId: 'tenant-a', steps: [] };
    const execution = { planId: 'p1', tenantId: 'tenant-b', status: 'completed', steps: [] };
    const result = engine.validate({ plan, execution, context: { tenantId: 'tenant-a' } });
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === 'tenant_consistency').passed).toBe(false);
  });
});

describe('Cognitive Core — Learning Engine', () => {
  test('registra execução no event ledger com payload sanitizado', async () => {
    const appendEventV1 = jest.fn(async () => ({}));
    const recordFailure = jest.fn(async () => ({}));
    const engine = createLearningEngine({ appendEventV1, recordFailure });

    await engine.record({
      executionId: 'e1',
      tenantId: 't1',
      intent: 'agendar',
      confidence: 0.9,
      latencyMs: 120,
      fallback: false,
      humanHandoff: false,
      result: { status: 'completed' },
      secretToken: 'deve-sumir',
    });

    expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      type: 'cognitive.execution.completed',
      correlationId: 'e1',
    }));
    expect(appendEventV1.mock.calls[0][0].payload.secretToken).toBe('[redacted]');
    expect(recordFailure).not.toHaveBeenCalled();
  });

  test('falha de execução também alimenta o pipeline RAP Learn', async () => {
    const appendEventV1 = jest.fn(async () => ({}));
    const recordFailure = jest.fn(async () => ({}));
    const engine = createLearningEngine({ appendEventV1, recordFailure });

    await engine.record({
      executionId: 'e2',
      tenantId: 't1',
      intent: 'criar_lead',
      result: { status: 'failed', failure: { step: 'create_lead', error: 'db down' } },
    });

    expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({ type: 'cognitive.execution.failed' }));
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      source: 'cognitive-core',
      sourceRef: 'e2',
    }));
  });

  test('falha de persistência de aprendizado nunca propaga (best-effort)', async () => {
    const engine = createLearningEngine({
      appendEventV1: jest.fn(async () => { throw new Error('ledger down'); }),
      recordFailure: jest.fn(async () => { throw new Error('learn down'); }),
    });
    await expect(engine.record({
      executionId: 'e3',
      tenantId: 't1',
      result: { status: 'failed' },
    })).resolves.toMatchObject({ recorded: true });
  });
});

describe('Cognitive Core — Cognitive Orchestrator (pipeline completo)', () => {
  test('exige tenant', async () => {
    const { orchestrator } = buildOrchestrator();
    await expect(orchestrator.process({ message: 'oi' })).rejects.toThrow('cognitive_orchestrator_tenant_required');
  });

  test('fluxo completo: remarcar agendamento executa plano e gera registro estruturado', async () => {
    const { orchestrator, learningRecords } = buildOrchestrator();
    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      userId: 'u1',
      message: 'quero remarcar minha consulta de amanhã',
    });

    expect(result.status).toBe('completed');
    expect(result.intent).toBe('remarcar_agendamento');
    expect(result.humanHandoff).toBe(false);
    expect(result.outputs.length).toBeGreaterThan(0);

    // Registro estruturado mínimo (Etapa 7)
    expect(learningRecords).toHaveLength(1);
    const record = learningRecords[0];
    for (const field of ['executionId', 'tenantId', 'channel', 'intent', 'confidence', 'plan', 'toolsExecuted', 'result', 'latencyMs', 'fallback', 'humanHandoff', 'createdAt']) {
      expect(record[field]).toBeDefined();
    }
    expect(record.tenantId).toBe('tenant-a');
    expect(record.channel).toBe('whatsapp');
    expect(record.toolsExecuted).toContain('rescheduleAppointment');
  });

  test('baixa confiança sem conversa: handoff humano sem executar tools', async () => {
    const { orchestrator, learningRecords } = buildOrchestrator();
    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      message: 'xyzzy plugh foo',
    });
    expect(result.status).toBe('human_handoff_requested');
    expect(result.humanHandoff).toBe(true);
    expect(result.fallback).toBe(true);
    expect(result.outputs).toHaveLength(0);
    expect(learningRecords[0].toolsExecuted).toHaveLength(0);
  });

  test('baixa confiança com conversa ativa: transfere para humano via tool', async () => {
    const { orchestrator } = buildOrchestrator();
    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      message: 'xyzzy plugh foo',
      payload: { ticketId: 'ticket-1' },
    });
    expect(result.intent).toBe('transferir_humano');
    expect(result.humanHandoff).toBe(true);
    expect(result.outputs.map((o) => o.step)).toContain('transfer_conversation');
  });

  test('ação crítica sem confirmação para e pede confirmação (não executa)', async () => {
    const { orchestrator, registry } = buildOrchestrator();
    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      message: 'preciso cancelar meu agendamento',
    });
    expect(result.status).toBe('halted_awaiting_confirmation');
    expect(result.requiresConfirmation).toBe(true);
    expect(registry.get('cancelAppointment').execute).not.toHaveBeenCalled();
  });

  test('ação crítica confirmada executa', async () => {
    const { orchestrator, registry } = buildOrchestrator();
    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      message: 'preciso cancelar meu agendamento',
      payload: { confirmed: true },
    });
    expect(result.status).toBe('completed');
    expect(registry.get('cancelAppointment').execute).toHaveBeenCalledTimes(1);
  });

  test('isolamento multi-tenant: cada execução leva apenas seu tenant às tools e ao contexto', async () => {
    const seenTenants = [];
    const registry = buildStubRegistry({
      onExecute: (id, input, context) => {
        seenTenants.push(context.tenantId);
        return { ok: true };
      },
    });
    const contextEngine = buildStubContextEngine();
    const { orchestrator } = buildOrchestrator({ toolRegistry: registry, contextEngine });

    await orchestrator.process({ tenantId: 'tenant-a', message: 'quero abrir um chamado' });
    await orchestrator.process({ tenantId: 'tenant-b', message: 'quero abrir um chamado' });

    expect(seenTenants).toContain('tenant-a');
    expect(seenTenants).toContain('tenant-b');
    expect(contextEngine.buildContext).toHaveBeenNthCalledWith(1, expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(contextEngine.buildContext).toHaveBeenNthCalledWith(2, expect.objectContaining({ tenantId: 'tenant-b' }));
  });

  test('falha de tool obrigatória resulta em status failed com registro de falha', async () => {
    const registry = buildStubRegistry({
      onExecute: (id) => {
        if (id === 'createTicket') throw new Error('fila indisponível');
        return { ok: true };
      },
    });
    const { orchestrator, learningRecords } = buildOrchestrator({ toolRegistry: registry });
    const result = await orchestrator.process({ tenantId: 'tenant-a', message: 'quero abrir um chamado' });
    expect(result.status).toBe('failed');
    expect(learningRecords[0].result.failure).toBeTruthy();
  });

  test('resposta operacional não expõe engines internas nem validação técnica', async () => {
    const { orchestrator } = buildOrchestrator();
    const result = await orchestrator.process({ tenantId: 'tenant-a', message: 'quero abrir um chamado' });
    expect(result.validation).toBeUndefined();
    expect(result.plan).toBeUndefined();
    expect(result.contextTrace).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual([
      'confidence', 'executionId', 'fallback', 'humanHandoff', 'intent',
      'latencyMs', 'outputs', 'requiresConfirmation', 'status', 'tenantId',
    ]);
  });
});

describe('Cognitive Core — Context Engine (isolamento e rastreabilidade)', () => {
  test('exige tenant e isola cache por tenant', async () => {
    const calls = [];
    const engine = createContextEngine({
      resolvers: {
        customer: async ({ tenantId }) => { calls.push(tenantId); return { id: `c-${tenantId}` }; },
        crm: async () => null,
        appointments: async () => null,
        conversation: async () => null,
        tickets: async () => null,
        campaigns: async () => null,
        metrics: async () => null,
      },
    });

    await expect(engine.buildContext({})).rejects.toThrow('cognitive_context_tenant_required');

    const ctxA = await engine.buildContext({ tenantId: 'tenant-a' });
    const ctxA2 = await engine.buildContext({ tenantId: 'tenant-a' });
    const ctxB = await engine.buildContext({ tenantId: 'tenant-b' });

    expect(ctxA.customer).toEqual({ id: 'c-tenant-a' });
    expect(ctxB.customer).toEqual({ id: 'c-tenant-b' });
    // cache: tenant-a resolvido uma vez; tenant-b separadamente (sem vazamento)
    expect(calls).toEqual(['tenant-a', 'tenant-b']);
    expect(ctxA2.trace.find((t) => t.source === 'customer').status).toBe('cache_hit');
  });

  test('fonte com erro é best-effort e rastreada', async () => {
    const engine = createContextEngine({
      resolvers: {
        customer: async () => { throw new Error('fora do ar'); },
        crm: async () => null,
        appointments: async () => null,
        conversation: async () => null,
        tickets: async () => null,
        campaigns: async () => null,
        metrics: async () => null,
      },
    });
    const ctx = await engine.buildContext({ tenantId: 't1' });
    expect(ctx.customer).toBeNull();
    expect(ctx.trace.find((t) => t.source === 'customer').status).toBe('error');
  });
});

describe('Cognitive Core — segregação de experiência (cross-check com Agent OS)', () => {
  const segregation = require('../../api/modules/agent-os/experience-segregation');

  test('rotas de QA Waves, Replay, Seeds, Mesh e RPA permanecem ocultas para PRODUCTION', () => {
    for (const route of ['/dev/qa-waves', '/qa-mesh', '/dev/rpa-replays', '/rpa-seeds', '/dev/rpa-test', '/qa']) {
      expect(segregation.validateRouteVisibility(route, 'PRODUCTION').visible).toBe(false);
    }
  });

  test('rotas operacionais permanecem visíveis para PRODUCTION', () => {
    for (const route of ['/workspace', '/inbox', '/crm', '/agenda', '/campaigns', '/analytics']) {
      expect(segregation.validateRouteVisibility(route, 'PRODUCTION').visible).toBe(true);
    }
  });
});
