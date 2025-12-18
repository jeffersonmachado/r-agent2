const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');
const {
  getOrCompileFlow,
  getCompiledFlowFromCache,
  clearCompiledFlowCache,
} = require('../compiledFlowCache');
const { executeStep } = require('../executeStep');

describe('Load tests - múltiplas sessões, cache e execução concorrente', () => {
  const tenantId = 't-load';

  const flow = {
    tenantId,
    id: 'flow-load',
    name: 'Fluxo para teste de carga',
    version: 1,
    nodes: [
      { id: 'n1', type: 'message', config: { text: 'Olá' }, next: 'n2' },
      { id: 'n2', type: 'message', config: { text: 'Tudo bem?' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  function createRegistry() {
    const registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('end', endNodeHandler);
    return registry;
  }

  function makeInitialState(sessionId) {
    return {
      tenantId,
      sessionId,
      flowId: flow.id,
      flowVersion: flow.version,
      currentNodeId: 'n1',
      variables: {},
      history: [],
      metadata: {},
    };
  }

  beforeEach(() => {
    clearCompiledFlowCache();
  });

  test('múltiplas sessões simultâneas reutilizam o mesmo CompiledFlow via cache', async () => {
    const registry = createRegistry();

    const compiled = getOrCompileFlow(flow);

    const sessions = Array.from({ length: 20 }, (_, i) => `s-load-${i + 1}`);

    const start = Date.now();

    await Promise.all(
      sessions.map(async (sid) => {
        let state = makeInitialState(sid);

        // Executa até o fim (máx. 5 passos por segurança)
        for (let i = 0; i < 5 && state.currentNodeId; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const res = await executeStep(state, compiled, { registry });
          state = res.state;
        }

        expect(state.currentNodeId).toBeNull();
      }),
    );

    const end = Date.now();
    const totalMs = end - start;

    // O cache deve conter exatamente uma entrada para este fluxo
    const fromCache = getCompiledFlowFromCache(tenantId, flow.id, flow.version);
    expect(fromCache).toBe(compiled);

    // Latência total para 20 sessões simples deve ser razoável
    // (valor alto apenas para detectar regressões grosseiras).
    expect(totalMs).toBeLessThan(5000);
  });

  test('execução concorrente com getOrCompileFlow não cria múltiplos CompiledFlow para mesma chave', async () => {
    const registry = createRegistry();

    const sessions = Array.from({ length: 30 }, (_, i) => `s-concurrent-${i + 1}`);

    const compiledInstances = new Set();

    await Promise.all(
      sessions.map(async (sid) => {
        const compiled = getOrCompileFlow(flow);
        compiledInstances.add(compiled);

        let state = makeInitialState(sid);

        for (let i = 0; i < 5 && state.currentNodeId; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const res = await executeStep(state, compiled, { registry });
          state = res.state;
        }

        expect(state.currentNodeId).toBeNull();
      }),
    );

    // Mesmo sob "concorrência", deve haver apenas um CompiledFlow em uso
    expect(compiledInstances.size).toBe(1);

    const fromCache = getCompiledFlowFromCache(tenantId, flow.id, flow.version);
    expect(fromCache).toBe([...compiledInstances][0]);
  });
});


