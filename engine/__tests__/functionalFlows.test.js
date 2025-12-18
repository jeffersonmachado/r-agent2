const { simulateFlow } = require('../flowSimulation');

describe('Functional flows with real-like scenarios', () => {
  const tenantId = 't-functional';

  const supportFlow = {
    tenantId,
    id: 'flow-support',
    name: 'Fluxo de suporte com roteamento e handoff',
    version: 1,
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá! Como posso ajudar?' }, next: 'capture' },
      { id: 'capture', type: 'user_input', config: { variable: 'user_message' }, next: 'router' },
      {
        id: 'router',
        type: 'router',
        config: {
          rules: [
            { condition: { op: 'contains', var: 'user_message', value: 'humano' }, next: 'handoff' },
            { condition: { op: 'always' }, next: 'end' },
          ],
        },
      },
      {
        id: 'handoff',
        type: 'handoff',
        config: { queue: 'suporte_n1' },
        next: 'end',
      },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  const aiFlow = {
    tenantId,
    id: 'flow-ai',
    name: 'Fluxo com nó de IA',
    version: 1,
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá! O que você precisa?' }, next: 'ask' },
      { id: 'ask', type: 'user_input', config: { variable: 'user_message' }, next: 'ai' },
      {
        id: 'ai',
        type: 'ai',
        config: {
          promptTemplate: 'Usuário disse: {{user_message}}',
          outputVariable: 'ai_answer',
        },
        next: 'end',
      },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  test('supportFlow executa fluxo completo com handoff e estado final consistente', async () => {
    const result = await simulateFlow(supportFlow, {
      maxSteps: 10,
      inputProvider: async (state) => {
        if (state.currentNodeId === 'capture') {
          return { text: 'Quero falar com um humano' };
        }
        return null;
      },
    });

    const { steps, events, replay } = result;

    // Executa fluxo completo: último passo deve ter currentNodeId null
    const lastStep = steps[steps.length - 1];
    expect(lastStep.stateAfter.currentNodeId).toBeNull();

    // Variáveis: user_message deve estar preenchida
    expect(lastStep.stateAfter.variables.user_message).toBe('Quero falar com um humano');
    // status de handoff no metadata
    expect(lastStep.stateAfter.metadata.status).toBe('waiting_human');

    // Eventos: deve existir ao menos um HANDOFF
    const types = events.map((e) => e.type);
    expect(types).toContain('HANDOFF');

    // Replay: mensagens na ordem correta
    expect(replay.flowId).toBe('flow-support');
    const texts = replay.messages.map((m) => m.text);
    expect(texts[0]).toBe('Olá! Como posso ajudar?');
    expect(texts).toContain('Quero falar com um humano');
  });

  test('aiFlow executa fluxo completo com nó de IA mock e estado final consistente', async () => {
    const result = await simulateFlow(aiFlow, {
      maxSteps: 10,
      inputProvider: async (state) => {
        if (state.currentNodeId === 'ask') {
          return { text: 'Preciso de ajuda com meu pedido' };
        }
        return null;
      },
    });

    const { steps, events, replay } = result;

    const lastStep = steps[steps.length - 1];
    expect(lastStep.stateAfter.currentNodeId).toBeNull();

    // Variáveis: ai_answer deve existir e conter a simulação
    const aiAnswer = lastStep.stateAfter.variables.ai_answer;
    expect(typeof aiAnswer).toBe('string');
    expect(aiAnswer).toContain('SIMULAÇÃO');

    // Eventos de IA: AI_REQUESTED e AI_RESPONSE devem ter ocorrido
    const types = events.map((e) => e.type);
    expect(types).toContain('AI_REQUESTED');
    expect(types).toContain('AI_RESPONSE');

    // Replay determinístico com mensagens do bot e usuário
    expect(replay.flowId).toBe('flow-ai');
    const userMessages = replay.messages.filter((m) => m.from === 'user').map((m) => m.text);
    const botMessages = replay.messages.filter((m) => m.from === 'bot').map((m) => m.text);

    expect(userMessages).toContain('Preciso de ajuda com meu pedido');
    // Pelo menos uma mensagem de IA simulada deve aparecer
    expect(botMessages.some((t) => t.includes('SIMULAÇÃO'))).toBe(true);
  });
});


