const { simulateFlow } = require('../flowSimulation');

describe('flowSimulation', () => {
  const baseFlow = {
    tenantId: 't1',
    id: 'flow-sim',
    name: 'Fluxo Simulação',
    version: 1,
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá' }, next: 'ask' },
      { id: 'ask', type: 'user_input', config: { variable: 'user_message' }, next: 'ai' },
      {
        id: 'ai',
        type: 'ai',
        config: {
          promptTemplate: 'Usuário disse: {{user_message}}',
        },
        next: 'end',
      },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  test('simulateFlow executa compileFlow + executeStep e produz replay', async () => {
    const result = await simulateFlow(baseFlow, {
      maxSteps: 10,
      inputProvider: async (state, index) => {
        if (state.currentNodeId === 'ask') {
          return { text: 'Oi simulação' };
        }
        return null;
      },
    });

    expect(result.compiledFlowInfo.id).toBe('flow-sim');
    expect(typeof result.compiledFlowInfo.versionHash).toBe('string');

    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);

    // A conversa deve terminar (currentNodeId null em algum ponto)
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep.stateAfter.currentNodeId).toBeNull();

    // Replay consistente com a sessão/fluxo
    expect(result.replay.sessionId).toBeDefined();
    expect(result.replay.flowId).toBe('flow-sim');
  });
});


