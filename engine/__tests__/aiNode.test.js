const { aiNodeHandler, _internal } = require('../nodes/aiNode');

describe('aiNodeHandler', () => {
  function makeState(overrides = {}) {
    return {
      tenantId: 't-ai',
      sessionId: 's-ai-1',
      flowId: 'flow-ai',
      flowVersion: 1,
      currentNodeId: 'ai',
      variables: {},
      history: [],
      metadata: {},
      ...overrides,
    };
  }

  const baseNode = {
    id: 'ai',
    type: 'ai',
    config: {
      promptTemplate: 'Usuário disse: {{user_message}}',
      outputVariable: 'ai_answer',
      fallbackText: '[fallback]',
    },
  };

  test('sucesso: provider retorna texto simples e preenche variável/output', async () => {
    const state = makeState({
      variables: { user_message: 'Olá mundo' },
    });

    const mockProvider = {
      generate: jest.fn().mockResolvedValue('Resposta da IA'),
    };

    const result = await aiNodeHandler(baseNode, state, { aiProvider: mockProvider });

    expect(result.nextState.variables.ai_answer).toBe('Resposta da IA');
    expect(result.output).toEqual({
      type: 'ai',
      text: 'Resposta da IA',
      variable: 'ai_answer',
    });

    const types = result.events.map((e) => e.type);
    expect(types).toContain('AI_REQUESTED');
    expect(types).toContain('AI_RESPONSE');
    // Não deve emitir AI_USAGE pois o provider não retornou usage/tokens
    expect(types).not.toContain('AI_USAGE');
  });

  test('erro: provider lança erro e handler usa fallback sem quebrar fluxo', async () => {
    const state = makeState({
      variables: { user_message: 'Olá erro' },
    });

    const mockProvider = {
      generate: jest.fn().mockRejectedValue(new Error('Falha na IA')),
    };

    const result = await aiNodeHandler(baseNode, state, { aiProvider: mockProvider });

    // Estado ainda válido (currentNodeId não é alterado pelo nó de IA)
    expect(result.nextState.currentNodeId).toBe(state.currentNodeId);

    // Fallback deve ser usado
    expect(result.output).toEqual({
      type: 'ai_error',
      text: '[fallback]',
    });

    const types = result.events.map((e) => e.type);
    expect(types).toContain('AI_REQUESTED');
    expect(types).toContain('AI_ERROR');
  });

  test('timeout simulado: provider rejeita com erro de timeout e fallback é aplicado', async () => {
    const state = makeState({
      variables: { user_message: 'Olá timeout' },
    });

    const timeoutError = new Error('Provider timeout');
    // @ts-ignore
    timeoutError.code = 'ETIMEDOUT';

    const mockProvider = {
      generate: jest.fn().mockRejectedValue(timeoutError),
    };

    const result = await aiNodeHandler(baseNode, state, { aiProvider: mockProvider });

    expect(result.output).toEqual({
      type: 'ai_error',
      text: '[fallback]',
    });

    const errorEvent = result.events.find((e) => e.type === 'AI_ERROR');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.payload.message).toContain('Provider timeout');
  });

  test('sucesso com JSON schema válido: resposta JSON é parseada e salva na variável', async () => {
    const node = {
      ...baseNode,
      config: {
        ...baseNode.config,
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
          },
          required: ['answer'],
        },
      },
    };

    const state = makeState({
      variables: { user_message: 'Olá JSON' },
    });

    const mockProvider = {
      generate: jest.fn().mockResolvedValue(JSON.stringify({ answer: 'ok' })),
    };

    const result = await aiNodeHandler(node, state, { aiProvider: mockProvider });

    expect(result.nextState.variables.ai_answer).toEqual({ answer: 'ok' });
    expect(result.output.type).toBe('ai');
  });

  test('falha de validação de JSON schema dispara fallback', async () => {
    const node = {
      ...baseNode,
      config: {
        ...baseNode.config,
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
          },
          required: ['answer'],
        },
      },
    };

    const state = makeState({
      variables: { user_message: 'Olá inválido' },
    });

    // JSON sem o campo obrigatório "answer"
    const mockProvider = {
      generate: jest.fn().mockResolvedValue(JSON.stringify({ wrong: true })),
    };

    const result = await aiNodeHandler(node, state, { aiProvider: mockProvider });

    expect(result.output).toEqual({
      type: 'ai_error',
      text: '[fallback]',
    });

    const errorEvent = result.events.find((e) => e.type === 'AI_ERROR');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.payload.validationErrors.length).toBeGreaterThan(0);
  });
});


