'use strict';

/**
 * Testes unitários: Event semantics do Cognitive Core (HARD-006 / FASE 8).
 *
 * Cobre:
 *  - handoff humano emite `agent.execution.handed_off` e NUNCA
 *    `agent.execution.completed`/`agent.execution.failed` nem eventos
 *    `business.outcome.*` (desfecho neutro, sem eventos contraditórios);
 *  - `completed` técnico sem `businessOutcome.valid` NÃO emite
 *    `agent.execution.completed` (INVARIANTE 4);
 *  - learning-engine registra handoff como `cognitive.execution.handed_off`
 *    e nunca como falha;
 *  - taxonomia eventModelV1 aceita os novos tipos.
 */

jest.mock('../../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createCognitiveOrchestrator } = require('../../../src/core/cognitive/cognitive-orchestrator');
const { createLearningEngine } = require('../../../src/core/cognitive/learning-engine');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { buildEventV1, EVENT_TYPES_V1 } = require('../../../api/events/eventModelV1');

const ACTOR = { userId: 'u1', classification: 'PRODUCTION', permissions: ['*'] };

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

function buildScheduleRegistry({ createAppointmentOutput } = {}) {
  const registry = createToolRegistry();
  const tools = [
    { id: 'searchCustomer', output: { customers: [] } },
    { id: 'schedule.findAvailability', output: { available: true } },
    { id: 'createAppointment', output: createAppointmentOutput || { appointment: { id: 'apt-1' } } },
    { id: 'sendWhatsappMessage', output: { messageId: 'msg-1' } },
  ];
  for (const tool of tools) {
    registry.register({
      id: tool.id,
      visibility: 'PRODUCTION',
      permissions: [],
      description: `stub ${tool.id}`,
      sideEffects: tool.id === 'createAppointment' || tool.id === 'sendWhatsappMessage',
      execute: jest.fn(async () => tool.output),
    });
  }
  return registry;
}

function buildOrchestrator({ intentResult, registry, events, learningRecords }) {
  return createCognitiveOrchestrator({
    toolRegistry: registry,
    contextEngine: buildStubContextEngine(),
    intentEngine: { classify: jest.fn(async () => intentResult) },
    agentSupervisor: null,
    learningEngine: {
      record: jest.fn(async (record) => { learningRecords.push(record); return { recorded: true }; }),
    },
    eventEmitter: async (event) => { events.push(event); },
  });
}

describe('Event Semantics — handoff humano é categoria própria', () => {
  test('handoff emite agent.execution.handed_off e nunca completed/failed/business.outcome', async () => {
    const events = [];
    const learningRecords = [];
    const orchestrator = buildOrchestrator({
      events,
      learningRecords,
      registry: buildScheduleRegistry(),
      intentResult: {
        intent: 'transferir_humano',
        confidence: 0.2,
        entities: {},
        source: 'fallback',
        rationale: 'low_confidence',
        fallback: true,
        humanHandoff: true,
      },
    });

    const result = await orchestrator.process({ tenantId: 't1', channel: 'whatsapp', message: 'xyzzy' });

    expect(result.status).toBe('human_handoff_requested');
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('agent.execution.handed_off');
    expect(eventTypes).not.toContain('agent.execution.completed');
    expect(eventTypes).not.toContain('agent.execution.failed');
    expect(eventTypes).not.toContain('business.outcome.validated');
    expect(eventTypes).not.toContain('business.outcome.failed');

    const handoffEvent = events.find((e) => e.type === 'agent.execution.handed_off');
    expect(handoffEvent.payload.status).toBe('human_handoff_requested');
    expect(learningRecords[0].result.status).toBe('human_handoff_requested');
  });

  test('completed técnico sem businessOutcome.valid NÃO emite completed nem validated', async () => {
    const events = [];
    const learningRecords = [];
    // createAppointment executa mas não gera agendamento real (sem appointment.id).
    const orchestrator = buildOrchestrator({
      events,
      learningRecords,
      registry: buildScheduleRegistry({ createAppointmentOutput: { ok: true } }),
      intentResult: { intent: 'agendar', confidence: 0.95, entities: {}, source: 'explicit' },
    });

    const result = await orchestrator.process({ tenantId: 't1', channel: 'api', payload: {} });

    expect(result.status).toBe('completed');
    expect(result.businessOutcome).toBe('outcome_not_achieved');
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('agent.execution.failed');
    expect(eventTypes).toContain('business.outcome.failed');
    expect(eventTypes).not.toContain('agent.execution.completed');
    expect(eventTypes).not.toContain('business.outcome.validated');
  });

  test('completed com outcome válido emite completed + validated (sem contraditórios)', async () => {
    const events = [];
    const learningRecords = [];
    const orchestrator = buildOrchestrator({
      events,
      learningRecords,
      registry: buildScheduleRegistry(),
      intentResult: { intent: 'agendar', confidence: 0.95, entities: {}, source: 'explicit' },
    });

    const result = await orchestrator.process({ tenantId: 't1', channel: 'api', payload: {} });

    expect(result.status).toBe('completed');
    expect(result.businessOutcome).toBe('appointment_created');
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('agent.execution.completed');
    expect(eventTypes).toContain('business.outcome.validated');
    expect(eventTypes).not.toContain('agent.execution.failed');
    expect(eventTypes).not.toContain('business.outcome.failed');
  });
});

describe('Event Semantics — learning engine não classifica handoff como falha', () => {
  test('handoff → cognitive.execution.handed_off, sem recordFailure', async () => {
    const appendEventV1 = jest.fn(async () => ({}));
    const recordFailure = jest.fn(async () => ({}));
    const engine = createLearningEngine({ appendEventV1, recordFailure });

    await engine.record({
      executionId: 'e-handoff',
      tenantId: 't1',
      intent: 'transferir_humano',
      humanHandoff: true,
      result: { status: 'human_handoff_requested' },
    });

    expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cognitive.execution.handed_off',
    }));
    expect(recordFailure).not.toHaveBeenCalled();
  });

  test('completed/failed mantêm os tipos originais', async () => {
    const appendEventV1 = jest.fn(async () => ({}));
    const recordFailure = jest.fn(async () => ({}));
    const engine = createLearningEngine({ appendEventV1, recordFailure });

    await engine.record({ executionId: 'e1', tenantId: 't1', result: { status: 'completed' } });
    await engine.record({ executionId: 'e2', tenantId: 't1', result: { status: 'failed', failure: { error: 'x' } } });

    expect(appendEventV1.mock.calls[0][0].type).toBe('cognitive.execution.completed');
    expect(appendEventV1.mock.calls[1][0].type).toBe('cognitive.execution.failed');
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });
});

describe('Event Semantics — taxonomia eventModelV1', () => {
  test('novos tipos de handoff são aceitos', () => {
    expect(EVENT_TYPES_V1.has('agent.execution.handed_off')).toBe(true);
    expect(EVENT_TYPES_V1.has('cognitive.execution.handed_off')).toBe(true);

    const event = buildEventV1({ tenantId: 't1', type: 'agent.execution.handed_off', payload: { status: 'human_handoff_requested' } });
    expect(event.type).toBe('agent.execution.handed_off');
  });

  test('tipos fora da taxonomia seguem rejeitados', () => {
    expect(() => buildEventV1({ tenantId: 't1', type: 'agent.execution.inventado' }))
      .toThrow('unsupported_event_type');
  });

  test('evento causal preserva identidade de run, execução, pai e causa', () => {
    const event = buildEventV1({
      eventId: 'evt-inbound-1',
      tenantId: 't1',
      type: 'channel.message.inbound',
      source: 'whatsapp-webhook',
      correlationId: 'wamid.real-1',
      parentEventId: null,
      causationId: 'wamid.real-1',
      runId: 'rap-release-20260821-120000-abcd1234',
      criticalJourneyId: 'support_ticket_flow',
      executionId: 'exec-real-1',
      principalId: 'channel:whatsapp',
    });

    expect(event).toEqual(expect.objectContaining({
      id: 'evt-inbound-1',
      correlation_id: 'wamid.real-1',
      parent_event_id: null,
      causation_id: 'wamid.real-1',
      run_id: 'rap-release-20260821-120000-abcd1234',
      critical_journey_id: 'support_ticket_flow',
      execution_id: 'exec-real-1',
      principal_id: 'channel:whatsapp',
    }));
  });
});

describe('Event Semantics — causalidade emitida pelo Cognitive Core', () => {
  test('contexto, intenção, plano, execução e outcome formam uma cadeia do mesmo run', async () => {
    const events = [];
    const learningRecords = [];
    let sequence = 0;
    const orchestrator = createCognitiveOrchestrator({
      toolRegistry: buildScheduleRegistry(),
      contextEngine: buildStubContextEngine(),
      intentEngine: {
        classify: jest.fn(async () => ({
          intent: 'agendar', confidence: 0.99, entities: {}, source: 'llm', rationale: 'explicit',
        })),
      },
      agentSupervisor: null,
      learningEngine: {
        record: jest.fn(async (record) => { learningRecords.push(record); return { recorded: true }; }),
      },
      eventIdFactory: () => `evt-runtime-${++sequence}`,
      eventEmitter: async (event) => {
        events.push(event);
        return { id: event.eventId };
      },
    });

    const result = await orchestrator.process({
      tenantId: 't1',
      channel: 'whatsapp',
      message: 'Quero agendar',
      correlationId: 'wamid.real-2',
      traceContext: {
        runId: 'rap-release-20260821-120000-abcd1234',
        criticalJourneyId: 'support_ticket_flow',
        parentEventId: 'evt-channel-inbound',
        causationId: 'evt-channel-inbound',
      },
    });

    expect(result.executionId).toBeTruthy();
    const causal = events.filter((event) => [
      'cognitive.context.completed',
      'cognitive.intent.classified',
      'cognitive.decision.completed',
      'agent.planning.completed',
      'agent.execution.started',
      'agent.execution.completed',
      'business.outcome.validated',
    ].includes(event.type));
    expect(causal.map((event) => event.type)).toEqual([
      'cognitive.context.completed',
      'cognitive.intent.classified',
      'cognitive.decision.completed',
      'agent.planning.completed',
      'agent.execution.started',
      'agent.execution.completed',
      'business.outcome.validated',
    ]);

    let parent = 'evt-channel-inbound';
    for (const event of causal) {
      expect(event).toEqual(expect.objectContaining({
        eventId: expect.any(String),
        parentEventId: parent,
        causationId: 'evt-channel-inbound',
        correlationId: 'wamid.real-2',
        runId: 'rap-release-20260821-120000-abcd1234',
        criticalJourneyId: 'support_ticket_flow',
        executionId: result.executionId,
      }));
      parent = event.eventId;
    }
  });
});
