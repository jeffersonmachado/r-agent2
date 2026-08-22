'use strict';

/**
 * Cognitive Entry Policy + integração ao fluxo operacional (testes 25 e 30).
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { decideEntryPath, PATHS } = require('../../api/services/cognitive/cognitiveEntryPolicy');
const {
  toBusinessMessage,
  resolveChannelPermissions,
  handleInboundWithCognitiveCore,
} = require('../../api/services/cognitive/inboundCognitiveHandler');

describe('Cognitive Entry Policy', () => {
  test('25. fluxo determinístico continua sendo o caminho padrão (cognitive desabilitado)', () => {
    const decision = decideEntryPath({ hasDeterministicFlow: true, message: 'oi' });
    expect(decision.path).toBe(PATHS.DETERMINISTIC_FLOW);
  });

  test('sem flow e cognitive desabilitado → HUMAN (nunca cai cegamente na LLM)', () => {
    const decision = decideEntryPath({ hasDeterministicFlow: false, message: 'oi' });
    expect(decision.path).toBe(PATHS.HUMAN);
  });

  test('cognitive habilitado em modo fallback: flow existente tem prioridade', () => {
    const decision = decideEntryPath({
      hasDeterministicFlow: true,
      cognitiveConfig: { enabled: true, mode: 'fallback' },
      message: 'quero agendar',
    });
    expect(decision.path).toBe(PATHS.DETERMINISTIC_FLOW);
  });

  test('cognitive habilitado sem flow → COGNITIVE; hints durable → DURABLE_PROCESS', () => {
    expect(decideEntryPath({
      hasDeterministicFlow: false,
      cognitiveConfig: { enabled: true },
      message: 'quero agendar',
    }).path).toBe(PATHS.COGNITIVE);

    expect(decideEntryPath({
      hasDeterministicFlow: true,
      cognitiveConfig: { enabled: true },
      payload: { waitForEvent: 'payment.confirmed' },
      message: 'aguardo pagamento',
    }).path).toBe(PATHS.DURABLE_PROCESS);
  });
});

describe('Outcome de negócio no canal (30)', () => {
  test('usuário final vê RESULTADOS, nunca infraestrutura', () => {
    const FORBIDDEN = /(rpa|mcp|replay|qa[\s_-]?wave|qa[\s_-]?mesh|action[\s_-]?chain|step executado|tool executada|seed)/i;

    expect(toBusinessMessage({ status: 'completed', intent: 'agendar' })).toBe('Agendamento realizado.');
    expect(toBusinessMessage({ status: 'completed', intent: 'iniciar_campanha' })).toBe('Campanha iniciada.');
    expect(toBusinessMessage({ status: 'completed', intent: 'criar_lead' })).toBe('Cadastro realizado com sucesso.');

    for (const intent of ['agendar', 'remarcar_agendamento', 'cancelar_agendamento', 'abrir_ticket', 'enviar_proposta', 'iniciar_campanha', 'criar_lead']) {
      expect(toBusinessMessage({ status: 'completed', intent })).not.toMatch(FORBIDDEN);
    }
    expect(toBusinessMessage({ status: 'failed', intent: 'agendar' })).not.toMatch(FORBIDDEN);
    expect(toBusinessMessage({ humanHandoff: true })).not.toMatch(FORBIDDEN);
  });

  test('service principal do canal é restrito e sem wildcard', () => {
    const permissions = resolveChannelPermissions(null);
    expect(permissions).not.toContain('*');
    expect(permissions).toContain('crm.read');
    expect(permissions).not.toContain('agenda.write'); // side effect exige declaração

    expect(() => resolveChannelPermissions(() => ['*'])).toThrow('wildcard');
  });

  test('handler inbound passa principal restrito ao orchestrator e envia outcome', async () => {
    const process = jest.fn(async () => ({
      executionId: 'e1', status: 'completed', intent: 'agendar', outputs: [],
    }));
    const sendText = jest.fn(async () => {});

    await handleInboundWithCognitiveCore({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      message: 'quero agendar amanhã',
      correlationId: 'msg-1',
      sendText,
      orchestrator: { process },
      appendEvent: jest.fn(async (event) => ({ id: event.eventId })),
      eventIdFactory: (() => { let n = 0; return () => `evt-entry-${++n}`; })(),
    });

    const call = process.mock.calls[0][0];
    expect(call.tenantId).toBe('tenant-a');
    expect(call.actor.principalType).toBe('service');
    expect(call.actor.permissions).not.toContain('*');
    expect(call.correlationId).toBe('msg-1');
    expect(call.traceContext).toEqual(expect.objectContaining({
      parentEventId: 'evt-entry-3',
      causationId: 'evt-entry-1',
    }));
    expect(sendText).toHaveBeenCalledWith('Agendamento realizado.');
  });

  test('handler emite channel→tenant→principal com uma única identidade causal', async () => {
    const emitted = [];
    const process = jest.fn(async () => ({
      executionId: 'exec-real-1', status: 'human_handoff_requested', intent: 'transferir_humano', humanHandoff: true,
    }));
    let n = 0;

    await handleInboundWithCognitiveCore({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      message: 'preciso de ajuda',
      conversationId: 'conv-real-1',
      correlationId: 'wamid.real-1',
      traceContext: {
        runId: 'rap-release-20260821-120000-abcd1234',
        criticalJourneyId: 'support_ticket_flow',
      },
      sendText: jest.fn(async () => {}),
      orchestrator: { process },
      eventIdFactory: () => `evt-entry-${++n}`,
      appendEvent: jest.fn(async (event) => { emitted.push(event); return { id: event.eventId }; }),
    });

    expect(emitted.map((event) => event.type)).toEqual([
      'channel.message.inbound',
      'tenant.resolution.completed',
      'principal.resolution.completed',
    ]);
    expect(emitted.map((event) => event.parentEventId)).toEqual([null, 'evt-entry-1', 'evt-entry-2']);
    for (const event of emitted) {
      expect(event).toEqual(expect.objectContaining({
        correlationId: 'wamid.real-1',
        causationId: 'evt-entry-1',
        runId: 'rap-release-20260821-120000-abcd1234',
        criticalJourneyId: 'support_ticket_flow',
        tenantId: 'tenant-a',
      }));
    }
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'wamid.real-1',
      traceContext: expect.objectContaining({
        parentEventId: 'evt-entry-3',
        causationId: 'evt-entry-1',
      }),
    }));
  });
});
