/**
 * Teste do índice de nós (nodeIndex) gerado em compileFlow.
 *
 * Cobre:
 * - compileFlow anexa um Map id -> nó ao CompiledFlow (lookup O(1)).
 * - findNode/resolveNodeType usam o índice quando presente.
 * - Fallback para busca linear em flows "crus" (simulador/testes).
 */

const { compileFlow } = require('../compileFlow');
const { findNode } = require('../utils');
const { executeStep } = require('../executeStep');
const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');

function makeFlow() {
  return {
    tenantId: 'tenant-1',
    id: 'flow-index',
    name: 'Flow Index',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', next: 'msg-1' },
      { id: 'msg-1', type: 'message', config: { text: 'oi' }, next: 'end-1' },
      { id: 'end-1', type: 'end', next: null },
    ],
  };
}

describe('compileFlow - nodeIndex', () => {
  test('anexa Map id -> nó congelado ao CompiledFlow', () => {
    const compiled = compileFlow(makeFlow());

    expect(compiled.nodeIndex).toBeInstanceOf(Map);
    expect(compiled.nodeIndex.size).toBe(3);
    expect(Object.isFrozen(compiled.nodeIndex)).toBe(true);
    // O índice referencia os MESMOS objetos congelados do array nodes
    expect(compiled.nodeIndex.get('msg-1')).toBe(compiled.nodes[1]);
  });

  test('findNode usa o índice quando presente (mesma referência)', () => {
    const compiled = compileFlow(makeFlow());

    const node = findNode(compiled, 'msg-1');
    expect(node).toBe(compiled.nodeIndex.get('msg-1'));
    expect(findNode(compiled, 'inexistente')).toBeNull();
  });

  test('findNode faz fallback para busca linear em flow cru (sem nodeIndex)', () => {
    const raw = makeFlow();

    expect(raw.nodeIndex).toBeUndefined();
    expect(findNode(raw, 'end-1')).toBe(raw.nodes[2]);
    expect(findNode(raw, 'inexistente')).toBeNull();
  });

  test('executeStep resolve nodeType via índice e executa normalmente', async () => {
    const compiled = compileFlow(makeFlow());
    const registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('end', endNodeHandler);

    const state = {
      tenantId: 'tenant-1',
      sessionId: 's1',
      flowId: 'flow-index',
      flowVersion: 1,
      currentNodeId: 'msg-1',
      variables: {},
      history: [],
      metadata: {},
    };

    const ledgerCalls = [];
    const result = await executeStep(state, compiled, {
      registry,
      input: {},
      deps: {
        executionLedger: {
          executionId: 'exec-1',
          appendNodeExecution: async (entry) => { ledgerCalls.push(entry); },
        },
      },
    });

    expect(result.output && result.output.type).toBe('message');
    // O ledger recebeu o nodeType resolvido a partir do nodeIndex
    expect(ledgerCalls).toHaveLength(1);
    expect(ledgerCalls[0].nodeType).toBe('message');
  });
});
