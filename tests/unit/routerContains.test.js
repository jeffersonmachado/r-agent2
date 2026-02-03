const { routerNodeHandler } = require('../../engine/nodes/basicNodes');

describe('router - contains', () => {
  it('roteia para next quando variável contém substring (ex: nome completo)', async () => {
    const state = {
      sessionId: 's-router-contains',
      flowId: 'flow-router-contains',
      currentNodeId: 'router-1',
      variables: { nome_completo: 'João Silva' },
      history: [],
      metadata: {},
    };

    const node = {
      id: 'router-1',
      type: 'router',
      config: {
        rules: [
          {
            condition: { op: 'contains', var: 'nome_completo', value: ' ' },
            next: 'ok',
          },
          {
            condition: { op: 'always' },
            next: 'fallback',
          },
        ],
      },
    };

    const out = await routerNodeHandler(node, state);
    expect(out.output).toEqual({ type: 'router', chosenNext: 'ok' });
  });
});

