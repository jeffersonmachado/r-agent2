/**
 * Testes para apiNode.js
 */

const { apiNodeHandler } = require('../nodes/apiNode');

describe('apiNode', () => {
  let node;
  let state;

  beforeEach(() => {
    node = {
      id: 'api-1',
      type: 'api',
      config: {
        url: 'https://api.example.com/test',
        method: 'GET',
      },
    };

    state = {
      sessionId: 'session-1',
      flowId: 'flow-1',
      currentNodeId: 'api-1',
      variables: {},
      history: [],
      metadata: {},
    };
  });

  test('deve retornar erro quando URL não é especificada', async () => {
    node.config = {};

    const result = await apiNodeHandler(node, state);

    expect(result.events[0].type).toBe('ERROR');
    expect(result.output.type).toBe('error');
    expect(result.output.message).toContain('URL não especificada');
    expect(result.nextState.variables.api_response.success).toBe(false);
  });

  test('deve fazer chamada HTTP em modo produção', async () => {
    // Mock fetch global
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
    });

    const result = await apiNodeHandler(node, state);

    expect(global.fetch).toHaveBeenCalled();
    expect(result.events[0].type).toBe('API_CALL');
    expect(result.nextState.variables.api_response.success).toBe(true);
  });

  test('deve usar mock em modo teste', async () => {
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    expect(result.events[0].type).toBe('API_CALL');
    expect(result.nextState.variables.api_response.mocked).toBe(true);
    expect(result.nextState.variables.api_response.success).toBe(true);
  });

  test('deve renderizar variáveis no URL', async () => {
    state.variables = { userId: '123' };
    node.config.url = 'https://api.example.com/users/{{userId}}';
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    expect(result.events[0].payload.url).toContain('123');
  });

  test('deve renderizar variáveis nos headers', async () => {
    state.variables = { apiKey: 'secret-key' };
    node.config.headers = { 'Authorization': 'Bearer {{apiKey}}' };
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    // Verifica que o handler foi executado sem erro
    expect(result.events[0].type).toBe('API_CALL');
  });

  test('deve usar método GET por padrão', async () => {
    delete node.config.method;
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    expect(result.events[0].payload.method).toBe('GET');
  });

  test('deve usar método POST quando especificado', async () => {
    node.config.method = 'POST';
    node.config.body = { data: 'test' };
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    expect(result.events[0].payload.method).toBe('POST');
  });

  test('deve usar outputVariable customizado', async () => {
    node.config.outputVariable = 'custom_response';
    state.metadata = { testMode: true };

    const result = await apiNodeHandler(node, state);

    expect(result.nextState.variables.custom_response).toBeDefined();
    expect(result.nextState.variables.api_response).toBeUndefined();
  });

  test('deve lidar com timeout', async () => {
    node.config.timeout = 100;
    global.fetch = jest.fn().mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({}),
        }), 200);
      });
    });

    const result = await apiNodeHandler(node, state);

    // Em modo produção, o timeout seria tratado pelo AbortController
    // Aqui apenas verificamos que o handler não trava
    expect(result).toBeDefined();
  });

  test('deve lidar com erro de fetch', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await apiNodeHandler(node, state);

    expect(result.events.some(e => e.type === 'ERROR')).toBe(true);
    expect(result.nextState.variables.api_response.success).toBe(false);
  });

  test('deve processar resposta JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ data: 'test' }),
    });

    const result = await apiNodeHandler(node, state);

    expect(result.nextState.variables.api_response.data).toEqual({ data: 'test' });
  });

  test('deve processar resposta de texto', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'plain text',
    });

    const result = await apiNodeHandler(node, state);

    expect(result.nextState.variables.api_response.data).toBe('plain text');
  });
});

