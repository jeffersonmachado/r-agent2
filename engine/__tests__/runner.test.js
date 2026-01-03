/**
 * Testes para runner.js
 */

const { runStep } = require('../runner');
const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');

describe('runStep', () => {
  let registry;
  let flow;
  let state;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('end', endNodeHandler);

    flow = {
      id: 'flow-1',
      name: 'Test Flow',
      version: 1,
      nodes: [
        { id: 'start', type: 'message', config: { text: 'Hello' }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    state = {
      sessionId: 'session-1',
      flowId: 'flow-1',
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };
  });

  test('deve executar um nó e retornar próximo estado', async () => {
    const result = await runStep(flow, state, registry);

    expect(result).toHaveProperty('nextState');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('output');
    expect(result.nextState.currentNodeId).toBe('end');
    expect(result.events.length).toBeGreaterThan(0);
  });

  test('deve retornar evento NO_CURRENT_NODE quando currentNodeId é null', async () => {
    const stateWithoutNode = {
      ...state,
      currentNodeId: null,
    };

    const result = await runStep(flow, stateWithoutNode, registry);

    expect(result.events[0].type).toBe('NO_CURRENT_NODE');
    expect(result.output.type).toBe('noop');
    expect(result.nextState).toEqual(stateWithoutNode);
  });

  test('deve retornar erro quando nó não é encontrado', async () => {
    const stateWithInvalidNode = {
      ...state,
      currentNodeId: 'non-existent',
    };

    const result = await runStep(flow, stateWithInvalidNode, registry);

    expect(result.events[0].type).toBe('ERROR');
    expect(result.events[0].payload.message).toContain('Node not found');
    expect(result.output.type).toBe('error');
    expect(result.nextState.currentNodeId).toBeNull();
  });

  test('deve incluir eventos NODE_ENTER e NODE_EXIT', async () => {
    const result = await runStep(flow, state, registry);

    const eventTypes = result.events.map(e => e.type);
    expect(eventTypes).toContain('NODE_ENTER');
    expect(eventTypes).toContain('NODE_EXIT');
  });

  test('deve usar timeout quando configurado', async () => {
    const slowHandler = jest.fn().mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            nextState: { ...state, currentNodeId: 'end' },
            events: [],
            output: { type: 'message', text: 'Slow' },
          });
        }, 1000);
      });
    });

    registry.register('slow', slowHandler);

    const flowWithTimeout = {
      ...flow,
      nodes: [
        {
          id: 'start',
          type: 'slow',
          config: { timeoutMs: 100 },
          next: 'end',
        },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowWithTimeout, state, registry);

    expect(result.events.some(e => e.type === 'ERROR')).toBe(true);
    expect(result.events.some(e => e.payload.errorType === 'timeout')).toBe(true);
  });

  test('deve fazer retry quando configurado', async () => {
    let attemptCount = 0;
    const failingHandler = jest.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('Temporary error');
      }
      return {
        nextState: { ...state, currentNodeId: 'end' },
        events: [],
        output: { type: 'message', text: 'Success' },
      };
    });

    registry.register('retry', failingHandler);

    const flowWithRetry = {
      ...flow,
      nodes: [
        {
          id: 'start',
          type: 'retry',
          config: {
            retry: { maxAttempts: 3 },
          },
          next: 'end',
        },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowWithRetry, state, registry);

    expect(failingHandler).toHaveBeenCalledTimes(3);
    expect(result.output.type).toBe('message');
    expect(result.nextState.currentNodeId).toBe('end');
  });

  test('deve usar fallback quando todas as tentativas falharem', async () => {
    const failingHandler = jest.fn().mockImplementation(() => {
      throw new Error('Always fails');
    });

    registry.register('failing', failingHandler);
    registry.register('fallback', messageNodeHandler);

    const flowWithFallback = {
      ...flow,
      nodes: [
        {
          id: 'start',
          type: 'failing',
          config: {
            retry: { maxAttempts: 2 },
            errorFallbackNodeId: 'fallback',
          },
          next: 'end',
        },
        {
          id: 'fallback',
          type: 'message',
          config: { text: 'Fallback message' },
          next: 'end',
        },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowWithFallback, state, registry);

    expect(result.output.type).toBe('node_error_fallback');
    expect(result.nextState.currentNodeId).toBe('fallback');
    expect(result.nextState.metadata.lastError).toBeDefined();
    expect(result.nextState.metadata.lastError.type).toBe('system');
  });

  test('deve classificar erros corretamente', async () => {
    const flowError = new Error('Flow error');
    flowError.code = 'ENGINE_ROUTER_INVALID_CONDITION';
    flowError.type = 'flow';

    const flowErrorHandler = jest.fn().mockImplementation(() => {
      throw flowError;
    });

    registry.register('flow-error', flowErrorHandler);

    const flowWithFlowError = {
      ...flow,
      nodes: [
        {
          id: 'start',
          type: 'flow-error',
          config: { retry: { maxAttempts: 1 } },
          next: 'end',
        },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowWithFlowError, state, registry);

    const errorEvent = result.events.find(e => e.type === 'ERROR');
    expect(errorEvent.payload.errorType).toBe('flow');
  });

  test('deve usar deps quando fornecido', async () => {
    const mockDeps = {
      persistence: {
        getFlowInfo: jest.fn(),
      },
    };

    const handlerWithDeps = jest.fn().mockImplementation((node, state, input, deps) => {
      expect(deps).toBe(mockDeps);
      return {
        nextState: { ...state, currentNodeId: 'end' },
        events: [],
        output: { type: 'message', text: 'With deps' },
      };
    });

    registry.register('with-deps', handlerWithDeps);

    const flowWithDeps = {
      ...flow,
      nodes: [
        { id: 'start', type: 'with-deps', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    await runStep(flowWithDeps, state, registry, null, mockDeps);

    expect(handlerWithDeps).toHaveBeenCalledWith(
      expect.any(Object),
      state,
      null,
      mockDeps
    );
  });

  test('deve usar serviços de persistência padrão quando deps não é fornecido', async () => {
    const handler = jest.fn().mockImplementation((node, state, input, deps) => {
      expect(deps).toHaveProperty('persistence');
      return {
        nextState: { ...state, currentNodeId: 'end' },
        events: [],
        output: { type: 'message', text: 'Default deps' },
      };
    });

    registry.register('test', handler);

    const flowTest = {
      ...flow,
      nodes: [
        { id: 'start', type: 'test', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    await runStep(flowTest, state, registry);

    expect(handler).toHaveBeenCalled();
  });

  test('deve processar output de router corretamente', async () => {
    const routerHandler = jest.fn().mockImplementation(() => {
      return {
        nextState: { ...state },
        events: [],
        output: {
          type: 'router',
          chosenNext: 'custom-next',
        },
      };
    });

    registry.register('router', routerHandler);

    const flowWithRouter = {
      ...flow,
      nodes: [
        { id: 'start', type: 'router', next: 'default-next' },
        { id: 'custom-next', type: 'message', config: { text: 'Custom' }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowWithRouter, state, registry);

    expect(result.nextState.currentNodeId).toBe('custom-next');
  });

  test('deve usar next do nó quando handler não redefine currentNodeId', async () => {
    const handler = jest.fn().mockImplementation(() => {
      return {
        nextState: { ...state }, // Não redefine currentNodeId
        events: [],
        output: { type: 'message', text: 'Test' },
      };
    });

    registry.register('test', handler);

    const flowTest = {
      ...flow,
      nodes: [
        { id: 'start', type: 'test', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    const result = await runStep(flowTest, state, registry);

    expect(result.nextState.currentNodeId).toBe('end');
  });
});

