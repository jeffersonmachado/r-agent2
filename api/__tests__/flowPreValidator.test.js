describe('FlowPreValidator (validateFlowDraft)', () => {
  const { validateFlowDraft } = require('../utils/flowPreValidator');

  const baseFlow = () => ({
    tenantId: 'tenant-demo',
    id: 'flow-test',
    name: 'Flow Test',
    version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'a' },
      { id: 'a', type: 'message', next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });

  test('1) detecta ciclo (self-loop) via nodes[].next', () => {
    const flow = baseFlow();
    flow.nodes = [
      { id: 'start', type: 'start', next: 'a' },
      { id: 'a', type: 'message', next: 'a' }, // self-loop
      { id: 'end', type: 'end' },
    ];

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_HAS_CYCLE');
      expect(err.message).toBe('Fluxo contém ciclo. O engine exige DAG puro.');
    }
  });

  test('1.1) detecta ciclo simples (a->b->a) via nodes[].next', () => {
    const flow = baseFlow();
    flow.nodes = [
      { id: 'start', type: 'start', next: 'a' },
      { id: 'a', type: 'message', next: 'b' },
      { id: 'b', type: 'message', next: 'a' }, // ciclo a->b->a
      { id: 'end', type: 'end' },
    ];

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_HAS_CYCLE');
    }
  });

  test('2) proíbe conexão com ancestrais (via router.rules.next)', () => {
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-test-ancestor',
      name: 'Flow Test Ancestor',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'r1' },
        {
          id: 'r1',
          type: 'router',
          config: {
            rules: [
              // back-edge para ancestral via rules.next
              { condition: { op: 'always' }, next: 'start' },
            ],
          },
          next: 'end',
        },
        { id: 'end', type: 'end' },
      ],
    };

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_POINTS_TO_ANCESTOR');
      expect(err.message).toBe('Nó aponta para ancestral do grafo. Fluxos devem ser acíclicos.');
    }
  });

  test('3) bloqueia fan-in ilegal (múltiplas entradas) fora de merge/handoff/end', () => {
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-test-fanin',
      name: 'Flow Test Fanin',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', next: 'x' },
        { id: 'b', type: 'message', next: 'x' },
        { id: 'x', type: 'message', next: 'end' }, // fan-in 2 ilegal
        { id: 'end', type: 'end' },
      ],
    };

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_ILLEGAL_FANIN');
      expect(err.message).toBe('Nó possui múltiplas entradas sem merge.');
    }
  });

  test('4) fallback não pode ter fan-in direto (>1)', () => {
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-test-fallback-fanin',
      name: 'Flow Test Fallback Fanin',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', next: 'fb' },
        { id: 'b', type: 'message', next: 'fb' },
        { id: 'fb', type: 'fallback', config: {}, next: { end: 'end' } },
        { id: 'end', type: 'end' },
      ],
    };

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_FALLBACK_FANIN');
      expect(err.message).toBe('Fallback não pode receber múltiplas entradas diretas. Use merge antes.');
    }
  });

  test('5) detecta reutilização de bloco decisório (revisita sem merge)', () => {
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-test-reuse',
      name: 'Flow Test Reuse',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', next: 'r2' },
        { id: 'b', type: 'message', next: 'r2' },
        // decisório revisitado (router) vindo de não-merge
        { id: 'r2', type: 'router', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      // Observação: fan-in ilegal também existe aqui, mas o requisito 5 exige erro específico quando decisório é revisitado
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_BLOCK_REUSE');
      expect(err.message).toBe('Reutilização de bloco decisório detectada. Blocos devem ser duplicados.');
    }
  });

  test('6) valida alcance: nós desconectados do start são bloqueados', () => {
    const flow = baseFlow();
    flow.nodes.push({ id: 'orphan', type: 'message', next: 'end' }); // não alcançável

    try {
      validateFlowDraft(flow);
      throw new Error('expected_to_throw');
    } catch (err) {
      expect(err).toBeTruthy();
      expect(err.code).toBe('FLOW_DISCONNECTED');
      expect(err.message).toBe('Existem nós não alcançáveis a partir do start.');
    }
  });

  test('7) fan-in válido direto em end deve passar', () => {
    const flow = {
      tenantId: 'tenant-demo',
      id: 'flow-test-fanin-end-pass',
      name: 'Flow Test Fanin End Pass',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', next: 'end' },
        { id: 'b', type: 'message', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    };

    expect(() => validateFlowDraft(flow)).not.toThrow();
  });
});

