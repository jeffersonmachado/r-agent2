const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');
const { wrapHandlerWithChaos, runChaosSimulation, _internal } = require('../chaosTesting');
const { executeStep } = require('../executeStep');
const { buildConversationReplay } = require('../replay');

describe('chaosTesting', () => {
  test('shouldFail usa failurePlan de forma determinística', () => {
    const cfg = { enabled: true, failurePlan: [true, false] };
    expect(_internal.shouldFail(cfg)).toBe(true);
    expect(_internal.shouldFail(cfg)).toBe(false);
  });

  test('wrapHandlerWithChaos pode injetar falhas sintéticas', async () => {
    const baseHandler = jest.fn(async (node, state) => ({
      nextState: state,
      events: [],
      output: { type: 'ok' },
    }));

    const cfg = { enabled: true, failurePlan: [true, false] };
    const chaotic = wrapHandlerWithChaos(baseHandler, cfg);

    const node = { id: 'n1', type: 'message', config: {} };
    const state = {
      tenantId: 't1',
      sessionId: 's1',
      flowId: 'f1',
      flowVersion: 1,
      currentNodeId: 'n1',
      variables: {},
      history: [],
      metadata: {},
    };

    // Primeira chamada deve falhar
    await expect(chaotic(node, state, {})).rejects.toThrow('Injected chaos failure');

    // Segunda chamada deve passar para o handler base
    const res = await chaotic(node, state, {});
    expect(res.output).toEqual({ type: 'ok' });
    expect(baseHandler).toHaveBeenCalledTimes(1);
  });

  test('runChaosSimulation executa fluxo e produz replay consistente', async () => {
    const flow = {
      tenantId: 't1',
      id: 'flow-1',
      name: 'Fluxo simples',
      version: 1,
      nodes: [
        { id: 'start', type: 'message', config: { text: 'Olá' }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('end', endNodeHandler);

    const initialState = {
      tenantId: 't1',
      sessionId: 's1',
      flowId: 'flow-1',
      flowVersion: 1,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    const { simulation, replay } = await runChaosSimulation(flow, initialState, registry, {
      maxSteps: 10,
    });

    expect(simulation.finalState.currentNodeId).toBeNull();
    expect(replay.sessionId).toBe('s1');
    expect(replay.flowId).toBe('flow-1');
    // Pelo menos uma mensagem do bot deve existir
    expect(replay.messages.length).toBeGreaterThanOrEqual(1);
  });

  test('falha de nó com retry/fallback mantém sessão viva e replay consistente', async () => {
    const flow = {
      tenantId: 't1',
      id: 'flow-chaos-failure',
      name: 'Fluxo com falha de nó e fallback',
      version: 1,
      nodes: [
        {
          id: 'unstable',
          type: 'message',
          config: {
            text: 'Instável',
            retry: { maxAttempts: 2 },
            errorFallbackNodeId: 'end',
          },
          next: null,
        },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const registry = new NodeRegistry();

    // Handler que sempre lança erro (simulando falha dura)
    const failingHandler = jest.fn(async () => {
      throw new Error('Falha dura');
    });

    registry.register('message', failingHandler);
    registry.register('end', endNodeHandler);

    let state = {
      tenantId: 't1',
      sessionId: 's-failure',
      flowId: flow.id,
      flowVersion: 1,
      currentNodeId: 'unstable',
      variables: {},
      history: [],
      metadata: {},
    };

    const allEvents = [];

    const step1 = await executeStep(state, flow, { registry });
    allEvents.push(...step1.events);

    // Após falha e aplicação de fallback, devemos ir para "end"
    expect(step1.state.currentNodeId).toBe('end');
    expect(step1.output.type).toBe('node_error_fallback');

    const step2 = await executeStep(step1.state, flow, { registry });
    allEvents.push(...step2.events);

    expect(step2.state.currentNodeId).toBeNull();

    const replay = buildConversationReplay(allEvents);
    const replayAgain = buildConversationReplay(allEvents);

    // Replay determinístico mesmo em cenário de falha
    expect(replay).toEqual(replayAgain);
    expect(replay.flowId).toBe(flow.id);
  });

  test('timeout configurável por nó dispara fallback sem quebrar sessão', async () => {
    const flow = {
      tenantId: 't1',
      id: 'flow-timeout',
      name: 'Fluxo com timeout',
      version: 1,
      nodes: [
        {
          id: 'slow',
          type: 'message',
          config: {
            text: 'Lento',
            timeoutMs: 10,
            errorFallbackNodeId: 'end',
          },
          next: null,
        },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const registry = new NodeRegistry();

    // Handler que nunca resolve rápido o suficiente (simula timeout)
    const slowHandler = jest.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              nextState: null,
              events: [],
              output: { type: 'should_not_happen' },
            });
          }, 1000);
        }),
    );

    registry.register('message', slowHandler);
    registry.register('end', endNodeHandler);

    let state = {
      tenantId: 't1',
      sessionId: 's-timeout',
      flowId: flow.id,
      flowVersion: 1,
      currentNodeId: 'slow',
      variables: {},
      history: [],
      metadata: {},
    };

    const allEvents = [];

    const step1 = await executeStep(state, flow, { registry });
    allEvents.push(...step1.events);

    // Devido ao timeout, devemos cair no fallback automaticamente
    expect(step1.state.currentNodeId).toBe('end');
    expect(step1.output.type).toBe('node_error_fallback');

    const step2 = await executeStep(step1.state, flow, { registry });
    allEvents.push(...step2.events);

    expect(step2.state.currentNodeId).toBeNull();

    const replay = buildConversationReplay(allEvents);
    const replayAgain = buildConversationReplay(allEvents);

    expect(replay).toEqual(replayAgain);
    expect(replay.flowId).toBe(flow.id);
  });

  test('exceção inesperada em handler dispara fallback e pode ser inspecionada no replay', async () => {
    const flow = {
      tenantId: 't1',
      id: 'flow-unexpected',
      name: 'Fluxo com exceção inesperada',
      version: 1,
      nodes: [
        { id: 'boom', type: 'message', config: { text: 'Boom' }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const registry = new NodeRegistry();

    const throwingHandler = jest.fn(async () => {
      // Exceção inesperada
      // eslint-disable-next-line no-undef
      JSON.parse('{invalid'); // Vai lançar
    });

    registry.register('message', throwingHandler);
    registry.register('end', endNodeHandler);

    let state = {
      tenantId: 't1',
      sessionId: 's-unexpected',
      flowId: flow.id,
      flowVersion: 1,
      currentNodeId: 'boom',
      variables: {},
      history: [],
      metadata: {},
    };

    const allEvents = [];

    const step1 = await executeStep(state, flow, { registry });
    allEvents.push(...step1.events);

    // Em caso de exceção inesperada, a engine aplica fallback (next do nó),
    // mantendo a sessão em um estado consistente.
    expect(step1.state.currentNodeId).toBe('end');
    expect(step1.output.type).toBe('node_error_fallback');

    const errorEvent = allEvents.find((e) => e.type === 'ERROR');
    expect(errorEvent).toBeDefined();

    const replay = buildConversationReplay(allEvents);
    const replayAgain = buildConversationReplay(allEvents);

    expect(replay).toEqual(replayAgain);
    expect(replay.flowId).toBe(flow.id);
  });
});


