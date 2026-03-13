import { describe, expect, it } from 'vitest';
import { reteToCanonical } from './reteToCanonical';
import { canonicalToRete } from './canonicalToRete';

function createRouterReteJson() {
  return {
    id: 'chatbot-flow@0.1.0',
    nodes: {
      1: {
        id: 1,
        data: { type: 'start', config: {}, __engineId: 'start-1' },
        position: [0, 0],
        outputs: {
          out: { connections: [{ node: 2, input: 'in' }] },
        },
      },
      2: {
        id: 2,
        data: {
          type: 'router',
          __engineId: 'router-1',
          config: {
            rules: [
              {
                condition: { var: 'intent', op: 'equals', value: 'sales' },
                next: '3',
              },
            ],
          },
        },
        position: [250, 0],
        inputs: { in: { connections: [] } },
        outputs: {
          rule_0: { connections: [{ node: 3, input: 'in' }] },
          default: { connections: [{ node: 4, input: 'in' }] },
        },
      },
      3: {
        id: 3,
        data: { type: 'message', config: { text: 'Vendas' }, __engineId: 'msg-sales' },
        position: [500, -60],
        inputs: { in: { connections: [] } },
        outputs: {},
      },
      4: {
        id: 4,
        data: { type: 'fallback', config: {}, __engineId: 'fallback-1' },
        position: [500, 60],
        inputs: { in: { connections: [] } },
        outputs: {},
      },
    },
  };
}

describe('rete/canonical adapters', () => {
  it('preserva IDs estáveis e referências internas ao normalizar Rete -> Canonical', () => {
    const canonical = reteToCanonical(createRouterReteJson(), { id: 'flow-1', name: 'Flow 1' });
    const routerNode = canonical.nodes.find((node) => node.id === 'router-1');

    expect(routerNode.type).toBe('gateway.exclusive');
    expect(routerNode.config.rules[0].next).toBe('msg-sales');
    expect(canonical.edges.map((edge) => `${edge.source}:${edge.target}`)).toEqual([
      'start-1:router-1',
      'router-1:msg-sales',
      'router-1:fallback-1',
    ]);
  });

  it('garante round-trip Rete -> Canonical -> Rete sem perder portas principais', () => {
    const reteJson = createRouterReteJson();
    const canonical = reteToCanonical(reteJson, { id: 'flow-1', name: 'Flow 1' });
    const roundTrip = canonicalToRete(canonical);

    expect(roundTrip.nodes['2'].data.__engineId).toBe('router-1');
    expect(roundTrip.nodes['2'].outputs.rule_0.connections).toEqual([{ node: 3, input: 'in' }]);
    expect(roundTrip.nodes['2'].outputs.default.connections).toEqual([{ node: 4, input: 'in' }]);
  });
});
