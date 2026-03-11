import { describe, it, expect } from 'vitest';
import { engineFlowToCanonical } from './engineFlowToCanonical';
import { canonicalToEngineFlow } from './canonicalToEngineFlow';
import { reteToCanonical } from './reteToCanonical';
import { canonicalToRete } from './canonicalToRete';

describe('process-adapters round trip', () => {
  it('converte FlowDefinition -> Canonical -> FlowDefinition preservando nós principais', () => {
    const flowDefinition = {
      tenantId: 'tenant_a',
      id: 'flow_1',
      name: 'Flow 1',
      version: 3,
      nodes: [
        { id: '1', type: 'start', config: {}, next: '2' },
        { id: '2', type: 'message', config: { text: 'Oi' }, next: '3' },
        { id: '3', type: 'end', config: {}, next: null },
      ],
      metadata: {},
    };

    const toCanonical = engineFlowToCanonical(flowDefinition);
    const toEngine = canonicalToEngineFlow(toCanonical.canonicalProcessDefinition, { tenantId: 'tenant_a' });

    expect(toCanonical.canonicalProcessDefinition.nodes).toHaveLength(3);
    expect(toEngine.flowDefinition.nodes).toHaveLength(3);
    expect(toEngine.flowDefinition.nodes[0].type).toBe('start');
    expect(toEngine.flowDefinition.nodes[2].type).toBe('end');
  });

  it('converte Rete -> Canonical -> Rete sem quebrar estrutura base', () => {
    const reteJson = {
      id: 'chatbot-flow@0.1.0',
      nodes: {
        1: {
          id: 1,
          data: { type: 'start', config: {} },
          outputs: {
            out: {
              connections: [{ node: 2, input: 'in' }],
            },
          },
        },
        2: {
          id: 2,
          data: { type: 'message', config: { text: 'Hello' } },
          outputs: {
            out: {
              connections: [{ node: 3, input: 'in' }],
            },
          },
        },
        3: {
          id: 3,
          data: { type: 'end', config: {} },
          outputs: {},
        },
      },
      connections: [],
    };

    const canonical = reteToCanonical(reteJson, {
      tenantId: 'tenant_r',
      id: 'flow_rete',
      name: 'Flow Rete',
      version: 1,
    });

    const roundTrip = canonicalToRete(canonical.canonicalProcessDefinition, { tenantId: 'tenant_r' });

    expect(canonical.canonicalProcessDefinition.nodes.length).toBeGreaterThan(0);
    expect(roundTrip.reteJson).toHaveProperty('nodes');
    expect(Object.keys(roundTrip.reteJson.nodes).length).toBeGreaterThan(0);
  });
});
