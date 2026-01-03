const { validateFlow } = require('../validator');
const { compileFlow } = require('../compileFlow');
const { NodeRegistry } = require('../nodeRegistry');
const {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
} = require('../nodes/basicNodes');
const { executeStep } = require('../executeStep');
const { buildConversationReplay } = require('../replay');

describe('Engine E2E - fluxos básicos', () => {
  const tenantId = 't-e2e';

  const minimalFlow = {
    tenantId,
    id: 'flow-minimal',
    name: 'Fluxo mínimo',
    version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'msg' },
      { id: 'msg', type: 'message', config: { text: 'Olá mundo' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  const invalidFlowStructural = {
    tenantId,
    id: 'flow-invalid',
    name: 'Fluxo inválido',
    version: 1,
    nodes: [
      // Nó aponta para um next inexistente e há um nó desconectado
      { id: 'start', type: 'message', config: { text: 'Olá' }, next: 'missing' },
      { id: 'isolated', type: 'end' },
    ],
    metadata: {},
  };

  function createRegistry() {
    const registry = new NodeRegistry();
    registry.register('start', startNodeHandler);
    registry.register('message', messageNodeHandler);
    registry.register('user_input', userInputNodeHandler);
    registry.register('router', routerNodeHandler);
    registry.register('handoff', handoffNodeHandler);
    registry.register('end', endNodeHandler);
    return registry;
  }

  test('Fluxo mínimo válido passa na validação, compila e executa até o fim', async () => {
    const validation = validateFlow(minimalFlow);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const compiled = compileFlow(minimalFlow);

    const registry = createRegistry();

    let state = {
      tenantId,
      sessionId: 's-e2e-1',
      flowId: minimalFlow.id,
      flowVersion: compiled.version,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    const allEvents = [];

    // Passo 1: nó "start" - apenas avança para o próximo nó
    const step1 = await executeStep(state, compiled, { registry });
    allEvents.push(...step1.events);
    expect(step1.output).toEqual({ type: 'start' });
    expect(step1.state.currentNodeId).toBe('msg');

    // Passo 2: nó "message" - produz a mensagem
    const step2 = await executeStep(step1.state, compiled, { registry });
    allEvents.push(...step2.events);
    expect(step2.output).toEqual({ type: 'message', text: 'Olá mundo' });
    expect(step2.state.currentNodeId).toBe('end');

    // Passo 3: nó "end"
    const step3 = await executeStep(step2.state, compiled, { registry });
    allEvents.push(...step3.events);
    expect(step3.output).toEqual({ type: 'end' });
    expect(step3.state.currentNodeId).toBeNull();
  });

  test('Fluxo com erro estrutural é reprovado pelo validador', () => {
    const validation = validateFlow(invalidFlowStructural);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    const codes = validation.errors.map((e) => e.code);
    expect(codes).toContain('NODE_TARGET_MISSING');
  });

  test('Execução passo a passo gera replay determinístico', async () => {
    const compiled = compileFlow(minimalFlow);
    const registry = createRegistry();

    let state = {
      tenantId,
      sessionId: 's-e2e-2',
      flowId: minimalFlow.id,
      flowVersion: compiled.version,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    const allEvents = [];

    const step1 = await executeStep(state, compiled, { registry });
    allEvents.push(...step1.events);

    const step2 = await executeStep(step1.state, compiled, { registry });
    allEvents.push(...step2.events);

    const replay1 = buildConversationReplay(allEvents);
    const replay2 = buildConversationReplay(allEvents);

    // Replay deve ser determinístico: mesma entrada de eventos => mesmo replay.
    expect(replay1).toEqual(replay2);

    // Timeline básica
    expect(replay1.sessionId).toBe('s-e2e-2');
    expect(replay1.flowId).toBe(minimalFlow.id);
    expect(replay1.messages.length).toBe(1);
    expect(replay1.messages[0].text).toBe('Olá mundo');
  });
});


