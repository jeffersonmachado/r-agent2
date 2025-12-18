const { NodeRegistry } = require('../nodeRegistry');
const {
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  endNodeHandler,
} = require('../nodes/basicNodes');
const { executeStep } = require('../executeStep');

describe('executeStep', () => {
  function createRegistry() {
    const registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('user_input', userInputNodeHandler);
    registry.register('router', routerNodeHandler);
    registry.register('end', endNodeHandler);
    return registry;
  }

  const flow = {
    id: 'flow-1',
    name: 'Teste Execução',
    version: 1,
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá' }, next: 'ask' },
      { id: 'ask', type: 'user_input', config: { variable: 'user_message' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };

  test('executa apenas um nó por chamada e atualiza estado', async () => {
    const registry = createRegistry();

    const initialState = {
      sessionId: 's1',
      flowId: flow.id,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    const result1 = await executeStep(initialState, flow, { registry });

    expect(result1.state.currentNodeId).toBe('ask');
    expect(result1.output).toEqual({ type: 'message', text: 'Olá' });
    expect(result1.events.length).toBeGreaterThan(0);

    // Segunda chamada: executa o nó "ask"
    const result2 = await executeStep(result1.state, flow, {
      registry,
      input: { text: 'Oi' },
    });

    expect(result2.state.currentNodeId).toBe('end');
    expect(result2.state.variables.user_message).toBe('Oi');
  });

  test('não altera o fluxo original durante a execução', async () => {
    const registry = createRegistry();

    const initialState = {
      sessionId: 's2',
      flowId: flow.id,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    const originalFlowCopy = JSON.parse(JSON.stringify(flow));

    await executeStep(initialState, flow, { registry });

    expect(flow).toEqual(originalFlowCopy);
  });

  test('falha se registry não for fornecido', async () => {
    const initialState = {
      sessionId: 's3',
      flowId: flow.id,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    await expect(executeStep(initialState, flow, null)).rejects.toThrow();
    await expect(executeStep(initialState, flow, {})).rejects.toThrow();
  });
});


