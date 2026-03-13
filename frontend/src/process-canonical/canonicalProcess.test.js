import { describe, expect, it } from 'vitest';
import { compileCanonicalProcessDefinition } from './canonicalCompiler';
import { canonicalToEngineFlow } from '../process-adapters/canonicalToEngineFlow';
import { engineFlowToCanonical } from '../process-adapters/engineFlowToCanonical';
import { legacyReteJsonToEngineFlow, reteJsonToEngineFlow } from '../engine-mapper/engineMapper';

function createLinearReteJson() {
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
          type: 'message',
          config: { text: 'Oi' },
          __engineId: 'msg-1',
        },
        position: [250, 0],
        inputs: { in: { connections: [] } },
        outputs: {
          out: { connections: [{ node: 3, input: 'in' }] },
        },
      },
      3: {
        id: 3,
        data: { type: 'end', config: {}, __engineId: 'end-1' },
        position: [500, 0],
        inputs: { in: { connections: [] } },
        outputs: {},
      },
    },
  };
}

describe('canonical process architecture', () => {
  it('mantém compatibilidade do mapper público no caminho Rete -> EngineFlow', () => {
    const reteJson = createLinearReteJson();

    const legacy = legacyReteJsonToEngineFlow(reteJson, {
      id: 'flow-1',
      name: 'Flow 1',
      tenantId: 'tenant-1',
    });
    const canonical = reteJsonToEngineFlow(reteJson, {
      id: 'flow-1',
      name: 'Flow 1',
      tenantId: 'tenant-1',
    });

    expect(canonical.tenantId).toBe(legacy.tenantId);
    expect(canonical.id).toBe(legacy.id);
    expect(canonical.name).toBe(legacy.name);
    expect(canonical.kind).toBe(legacy.kind);
    expect(canonical.nodes).toEqual(legacy.nodes);
    expect(canonical.metadata.positions).toEqual(legacy.metadata.positions);
    expect(canonical.metadata.canonical.entrypoints).toEqual(['start-1']);
  });

  it('compila processo canônico em estrutura determinística para runtime', () => {
    const canonical = engineFlowToCanonical({
      id: 'flow-1',
      name: 'Flow 1',
      tenantId: 'tenant-1',
      nodes: [
        { id: 'start-1', type: 'start', config: {}, next: 'msg-1' },
        { id: 'msg-1', type: 'message', config: { text: 'Oi' }, next: 'end-1' },
        { id: 'end-1', type: 'end', config: {}, next: null },
      ],
      metadata: {
        positions: {
          'start-1': [0, 0],
          'msg-1': [250, 0],
          'end-1': [500, 0],
        },
      },
    });

    const compiled = compileCanonicalProcessDefinition(canonical);
    const flow = canonicalToEngineFlow(compiled.canonical, {
      id: 'flow-1',
      name: 'Flow 1',
      tenantId: 'tenant-1',
    });

    expect(compiled.adjacency['start-1']).toHaveLength(1);
    expect(flow.nodes).toEqual([
      { id: 'start-1', type: 'start', config: {}, next: 'msg-1' },
      { id: 'msg-1', type: 'message', config: { text: 'Oi' }, next: 'end-1' },
      { id: 'end-1', type: 'end', config: {}, next: null },
    ]);
  });
});
