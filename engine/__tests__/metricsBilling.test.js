const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');
const { executeStep } = require('../executeStep');
const { setMetricsCollector } = require('../metrics');

describe('Métricas e lógica de billing (camada externa)', () => {
  const tenantId = 't-plan';

  const flow = {
    tenantId,
    id: 'flow-plan',
    name: 'Fluxo para teste de métricas/billing',
    version: 1,
    nodes: [
      { id: 'n1', type: 'message', config: { text: 'Passo 1' }, next: 'n2' },
      { id: 'n2', type: 'message', config: { text: 'Passo 2' }, next: 'end' },
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

  function makeState() {
    return {
      tenantId,
      sessionId: 's-plan-1',
      flowId: flow.id,
      flowVersion: 1,
      currentNodeId: 'n1',
      variables: {},
      history: [],
      metadata: {},
    };
  }

  afterEach(() => {
    // Remove collector após cada teste para evitar interferência
    setMetricsCollector(null);
  });

  test('mede métricas por nó (nodeId) usando collector', async () => {
    const registry = createRegistry();
    let state = makeState();

    /** @type {import('../metrics').MetricEvent[]} */
    const collected = [];

    setMetricsCollector((metricEvents) => {
      collected.push(...metricEvents);
    });

    // Executa dois passos (n1 e n2), end fecha a conversa
    const step1 = await executeStep(state, flow, { registry });
    state = step1.state;
    const step2 = await executeStep(state, flow, { registry });

    expect(step2.state.currentNodeId).toBe('end');

    // Deve ter métricas para ambos os nós n1 e n2
    const nodeIds = new Set(collected.map((m) => m.nodeId));
    expect(nodeIds.has('n1')).toBe(true);
    expect(nodeIds.has('n2')).toBe(true);
  });

  test('aplica limite por plano com base em métricas agregadas (sem alterar engine)', async () => {
    const registry = createRegistry();
    let state = makeState();

    /** @type {import('../metrics').MetricEvent[]} */
    const collected = [];

    setMetricsCollector((metricEvents) => {
      collected.push(...metricEvents);
    });

    const PLAN_NODE_LIMIT = 3; // Exemplo: no máximo 3 eventos de nó (NODE_ENTER) por sessão

    const countNodeEnters = () =>
      collected.filter((m) => m.eventType === 'NODE_ENTER' && m.sessionId === state.sessionId).length;

    let stepsExecuted = 0;

    // Loop externo (camada de billing) controla se ainda podemos executar passos
    // com base nas métricas já coletadas.
    while (state.currentNodeId && countNodeEnters() < PLAN_NODE_LIMIT) {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeStep(state, flow, { registry });
      state = result.state;
      stepsExecuted += 1;
    }

    // Não deve ultrapassar o limite configurado
    expect(countNodeEnters()).toBeLessThanOrEqual(PLAN_NODE_LIMIT);
    // Foram executados pelo menos 1 passo
    expect(stepsExecuted).toBeGreaterThan(0);
  });

  test('bloqueia execuções adicionais ao exceder limite do plano', async () => {
    const registry = createRegistry();
    let state = makeState();

    /** @type {import('../metrics').MetricEvent[]} */
    const collected = [];

    setMetricsCollector((metricEvents) => {
      collected.push(...metricEvents);
    });

    // Limite agressivo: apenas 1 NODE_ENTER permitido
    const PLAN_NODE_LIMIT = 1;

    const countNodeEnters = () =>
      collected.filter((m) => m.eventType === 'NODE_ENTER' && m.sessionId === state.sessionId).length;

    let stepsExecuted = 0;

    // Primeiro passo: permitido
    const first = await executeStep(state, flow, { registry });
    state = first.state;
    stepsExecuted += 1;

    expect(countNodeEnters()).toBeGreaterThan(0);

    // Camada de billing detecta que o limite foi atingido e NÃO chama mais executeStep
    if (countNodeEnters() >= PLAN_NODE_LIMIT) {
      // Bloqueio explícito de novas execuções
      // (nenhuma chamada adicional a executeStep deve acontecer aqui)
    } else {
      // eslint-disable-next-line no-await-in-loop
      const second = await executeStep(state, flow, { registry });
      state = second.state;
      stepsExecuted += 1;
    }

    // Confirmamos que apenas 1 passo foi executado, respeitando o bloqueio
    expect(stepsExecuted).toBe(1);
    // E que a conversa ainda não chegou ao fim (pois o plano bloqueou antes)
    expect(state.currentNodeId).toBe('n2');
  });
});


