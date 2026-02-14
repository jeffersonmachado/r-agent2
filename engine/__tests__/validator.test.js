const { validateFlow, _internal } = require('../validator');

describe('validator', () => {
  const tenantId = 't-validator';

  describe('validateFlow - casos básicos', () => {
    test('fluxo válido simples passa na validação', () => {
      const flow = {
        tenantId,
        id: 'flow-valid',
        name: 'Fluxo válido',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'msg' },
          { id: 'msg', type: 'message', config: { text: 'Olá' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('fluxo sem nós retorna inválido (caso extremo)', () => {
      const flow = {
        tenantId,
        id: 'flow-empty',
        name: 'Fluxo vazio',
        version: 1,
        nodes: [],
        metadata: {},
      };

      const result = validateFlow(flow);
      // O validador exige pelo menos um nó, um start e um end
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Deve ter erro de fluxo vazio e falta de start/end
      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toContain('EMPTY_FLOW');
    });

    test('fluxo com apenas um nó end é inválido (falta start)', () => {
      const flow = {
        tenantId,
        id: 'flow-single',
        name: 'Fluxo único',
        version: 1,
        nodes: [{ id: 'end', type: 'end' }],
        metadata: {},
      };

      const result = validateFlow(flow);
      // O validador exige pelo menos um nó start
      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toContain('MISSING_START_NODE');
    });

    test('fluxo sem ações é inválido (apenas start, end e router)', () => {
      const flow = {
        tenantId,
        id: 'flow-no-actions',
        name: 'Fluxo sem ações',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router1' },
          { id: 'router1', type: 'router', config: { rules: [{ condition: { op: 'always' }, next: 'end' }] } },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toContain('FLOW_WITHOUT_ACTIONS');
    });

    test('fluxo com apenas start e end é inválido (sem ações)', () => {
      const flow = {
        tenantId,
        id: 'flow-start-end-only',
        name: 'Fluxo apenas start e end',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toContain('FLOW_WITHOUT_ACTIONS');
    });
  });

  describe('validateFlow - nós desconectados', () => {
    test('detecta nó isolado não alcançável', () => {
      const flow = {
        tenantId,
        id: 'flow-disconnected',
        name: 'Fluxo com nó desconectado',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'end' },
          { id: 'end', type: 'end' },
          { id: 'isolated', type: 'message', config: { text: 'Isolado' } },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const disconnectedError = result.errors.find((e) => e.code === 'NODE_DISCONNECTED');
      expect(disconnectedError).toBeDefined();
      expect(disconnectedError.nodeIds).toContain('isolated');
    });

    test('detecta múltiplos nós desconectados', () => {
      const flow = {
        tenantId,
        id: 'flow-multi-disconnected',
        name: 'Fluxo com múltiplos nós desconectados',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'end' },
          { id: 'end', type: 'end' },
          { id: 'isolated1', type: 'message', config: { text: 'Isolado 1' } },
          { id: 'isolated2', type: 'message', config: { text: 'Isolado 2' } },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const disconnectedError = result.errors.find((e) => e.code === 'NODE_DISCONNECTED');
      expect(disconnectedError).toBeDefined();
      expect(disconnectedError.nodeIds).toContain('isolated1');
      expect(disconnectedError.nodeIds).toContain('isolated2');
    });
  });

  describe('validateFlow - loops inválidos', () => {
    test('detecta loop simples', () => {
      const flow = {
        tenantId,
        id: 'flow-loop',
        name: 'Fluxo com loop',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'a' },
          { id: 'a', type: 'message', config: { text: 'A' }, next: 'b' },
          { id: 'b', type: 'message', config: { text: 'B' }, next: 'a' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const loopError = result.errors.find((e) => e.code === 'INVALID_LOOP');
      expect(loopError).toBeDefined();
      expect(loopError.nodeIds).toContain('a');
      expect(loopError.nodeIds).toContain('b');
    });

    test('detecta auto-loop (nó apontando para si mesmo)', () => {
      const flow = {
        tenantId,
        id: 'flow-self-loop',
        name: 'Fluxo com auto-loop',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'loop' },
          { id: 'loop', type: 'message', config: { text: 'Loop' }, next: 'loop' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const loopError = result.errors.find((e) => e.code === 'INVALID_LOOP');
      expect(loopError).toBeDefined();
      expect(loopError.nodeIds).toContain('loop');
    });

    test('permite loop controlado quando há saída limit_exceeded para fora do ciclo', () => {
      const flow = {
        tenantId,
        id: 'flow-controlled-loop',
        name: 'Fluxo com loop controlado',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              loopMaxAttempts: 3,
              rules: [{ condition: { op: 'always' }, next: 'b' }],
            },
            next: { default: 'b', limit_exceeded: 'end' },
          },
          { id: 'b', type: 'message', config: { text: 'B' }, next: 'router' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
      expect(result.errors.find((e) => e.code === 'INVALID_LOOP')).toBeUndefined();
    });
  });

  describe('validateFlow - tipos incompatíveis', () => {
    test('detecta conexão incompatível: handoff -> message', () => {
      const flow = {
        tenantId,
        id: 'flow-incompatible',
        name: 'Fluxo com tipos incompatíveis',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'handoff' },
          { id: 'handoff', type: 'handoff', config: {}, next: 'msg' },
          { id: 'msg', type: 'message', config: { text: 'Não deveria chegar aqui' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const typeError = result.errors.find((e) => e.code === 'TYPE_INCOMPATIBLE');
      expect(typeError).toBeDefined();
      expect(typeError.nodeIds).toContain('handoff');
      expect(typeError.nodeIds).toContain('msg');
      expect(typeError.details.fromType).toBe('handoff');
      expect(typeError.details.toType).toBe('message');
    });

    test('detecta múltiplas conexões incompatíveis', () => {
      const flow = {
        tenantId,
        id: 'flow-multi-incompatible',
        name: 'Fluxo com múltiplas incompatibilidades',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'handoff1' },
          { id: 'handoff1', type: 'handoff', config: {}, next: 'msg1' },
          { id: 'msg1', type: 'message', config: { text: 'Erro 1' }, next: 'handoff2' },
          { id: 'handoff2', type: 'handoff', config: {}, next: 'msg2' },
          { id: 'msg2', type: 'message', config: { text: 'Erro 2' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const typeErrors = result.errors.filter((e) => e.code === 'TYPE_INCOMPATIBLE');
      expect(typeErrors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateFlow - nós alvo ausentes', () => {
    test('detecta referência a nó inexistente', () => {
      const flow = {
        tenantId,
        id: 'flow-missing-target',
        name: 'Fluxo com nó alvo ausente',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'missing' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const missingError = result.errors.find((e) => e.code === 'NODE_TARGET_MISSING');
      expect(missingError).toBeDefined();
      expect(missingError.nodeIds).toContain('start');
      expect(missingError.details.to).toBe('missing');
    });

    test('detecta múltiplas referências a nós ausentes', () => {
      const flow = {
        tenantId,
        id: 'flow-multi-missing',
        name: 'Fluxo com múltiplos alvos ausentes',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'missing1' },
          { id: 'node1', type: 'message', config: { text: 'A' }, next: 'missing2' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const missingErrors = result.errors.filter((e) => e.code === 'NODE_TARGET_MISSING');
      expect(missingErrors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateFlow - routers com regras', () => {
    test('valida conexões de router com múltiplas regras', () => {
      const flow = {
        tenantId,
        id: 'flow-router',
        name: 'Fluxo com router',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [
                { condition: { op: 'equals', var: 'var1', value: 'a' }, next: 'msg1' },
                { condition: { op: 'equals', var: 'var1', value: 'b' }, next: 'msg2' },
              ],
            },
            next: 'end',
          },
          { id: 'msg1', type: 'message', config: { text: 'Mensagem 1' }, next: 'end' },
          { id: 'msg2', type: 'message', config: { text: 'Mensagem 2' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
    });

    test('detecta regra de router apontando para nó inexistente', () => {
      const flow = {
        tenantId,
        id: 'flow-router-missing',
        name: 'Fluxo com router com alvo ausente',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [{ condition: 'var1 === "a"', next: 'missing' }],
            },
            next: 'end',
          },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const missingError = result.errors.find((e) => e.code === 'NODE_TARGET_MISSING');
      expect(missingError).toBeDefined();
      expect(missingError.details.to).toBe('missing');
    });

    test('detecta router sem fallback explícito', () => {
      const flow = {
        tenantId,
        id: 'flow-router-no-fallback',
        name: 'Fluxo com router sem fallback',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [
                { condition: { op: 'equals', var: 'var1', value: 'a' }, next: 'msg1' },
                // Sem regra "always" e sem defaultNext
              ],
            },
            // Sem campo next também
          },
          { id: 'msg1', type: 'message', config: { text: 'Mensagem 1' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);

      const fallbackError = result.errors.find((e) => e.code === 'ROUTER_MISSING_FALLBACK');
      expect(fallbackError).toBeDefined();
    });

    test('valida router com fallback via regra always', () => {
      const flow = {
        tenantId,
        id: 'flow-router-always',
        name: 'Fluxo com router com always',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [
                { condition: { op: 'equals', var: 'var1', value: 'a' }, next: 'msg1' },
                { condition: { op: 'always' }, next: 'end' },
              ],
            },
          },
          { id: 'msg1', type: 'message', config: { text: 'Mensagem 1' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
    });

    test('valida router com fallback via defaultNext', () => {
      const flow = {
        tenantId,
        id: 'flow-router-default',
        name: 'Fluxo com router com defaultNext',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'router' },
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [
                { condition: { op: 'equals', var: 'var1', value: 'a' }, next: 'msg1' },
              ],
            },
            next: 'end', // Fallback via defaultNext
          },
          { id: 'msg1', type: 'message', config: { text: 'Mensagem 1' }, next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFlow - casos combinados', () => {
    test('detecta múltiplos tipos de erro simultaneamente', () => {
      const flow = {
        tenantId,
        id: 'flow-multi-errors',
        name: 'Fluxo com múltiplos erros',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'missing' },
          { id: 'handoff', type: 'handoff', config: {}, next: 'msg' },
          { id: 'msg', type: 'message', config: { text: 'Erro' }, next: 'isolated' },
          { id: 'isolated', type: 'end' },
        ],
        metadata: {},
      };

      const result = validateFlow(flow);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);

      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain('NODE_TARGET_MISSING');
      expect(errorCodes).toContain('TYPE_INCOMPATIBLE');
      expect(errorCodes).toContain('NODE_DISCONNECTED');
    });
  });

  describe('_internal helpers', () => {
    test('buildEdges constrói arestas corretamente', () => {
      const flow = {
        tenantId,
        id: 'flow-test',
        name: 'Teste',
        version: 1,
        nodes: [
          { id: 'a', type: 'message', next: 'b' },
          { id: 'b', type: 'end' },
        ],
        metadata: {},
      };

      const edges = _internal.buildEdges(flow);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({ from: 'a', to: 'b' });
    });

    test('buildEdges inclui regras de router', () => {
      const flow = {
        tenantId,
        id: 'flow-router-test',
        name: 'Teste Router',
        version: 1,
        nodes: [
          {
            id: 'router',
            type: 'router',
            config: {
              rules: [
                { condition: 'a', next: 'msg1' },
                { condition: 'b', next: 'msg2' },
              ],
            },
            next: 'end',
          },
          { id: 'msg1', type: 'message', next: 'end' },
          { id: 'msg2', type: 'message', next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const edges = _internal.buildEdges(flow);
      // Deve ter: router -> msg1, router -> msg2, router -> end, msg1 -> end, msg2 -> end
      expect(edges.length).toBeGreaterThanOrEqual(3);
      expect(edges.some((e) => e.from === 'router' && e.to === 'msg1')).toBe(true);
      expect(edges.some((e) => e.from === 'router' && e.to === 'msg2')).toBe(true);
    });

    test('findEntryNodes encontra nós de entrada', () => {
      const flow = {
        tenantId,
        id: 'flow-test',
        name: 'Teste',
        version: 1,
        nodes: [
          { id: 'start', type: 'start', next: 'end' },
          { id: 'end', type: 'end' },
        ],
        metadata: {},
      };

      const edges = _internal.buildEdges(flow);
      const entries = _internal.findEntryNodes(flow, edges);
      expect(entries).toContain('start');
    });
  });
});

