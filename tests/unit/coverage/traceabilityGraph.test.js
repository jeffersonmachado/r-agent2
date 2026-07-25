'use strict';

const {
  TraceabilityGraph,
  CRITICALITY_WEIGHTS,
  EDGE_STATUSES,
} = require('../../../qa/coverage/traceabilityGraph');

function buildGraph() {
  const graph = new TraceabilityGraph();
  graph.addNode({ id: 'j1', type: 'journey', criticality: 'CRITICAL' });
  graph.addNode({ id: 'p1', type: 'path' });
  graph.addNode({ id: 'a1', type: 'api' });
  graph.addNode({ id: 'e1', type: 'evidence' });
  graph.addNode({ id: 'x1', type: 'page' });
  return graph;
}

describe('coverage/traceabilityGraph', () => {
  test('pesos de criticidade exportados', () => {
    expect(CRITICALITY_WEIGHTS).toEqual({ CRITICAL: 5, HIGH: 3, NORMAL: 1 });
  });

  test('CONFIRMED: EXPECTED + observada', () => {
    const graph = buildGraph();
    graph.declareEdge('j1', 'p1').observeEdge('j1', 'p1');
    const statuses = graph.computeEdgeStatuses({ executed: true });
    expect(statuses).toEqual([{ from: 'j1', to: 'p1', status: EDGE_STATUSES.CONFIRMED }]);
  });

  test('UNEXPECTED: observada sem declaração', () => {
    const graph = buildGraph();
    graph.observeEdge('p1', 'a1');
    const statuses = graph.computeEdgeStatuses({ executed: true });
    expect(statuses).toEqual([{ from: 'p1', to: 'a1', status: EDGE_STATUSES.UNEXPECTED }]);
  });

  test('MISSING: declarada sem observação após execução; PENDING antes da execução', () => {
    const graph = buildGraph();
    graph.declareEdge('p1', 'a1');
    expect(graph.computeEdgeStatuses({ executed: false }))
      .toEqual([{ from: 'p1', to: 'a1', status: EDGE_STATUSES.PENDING }]);
    expect(graph.computeEdgeStatuses({ executed: true }))
      .toEqual([{ from: 'p1', to: 'a1', status: EDGE_STATUSES.MISSING }]);
  });

  test('arestas exigem nós conhecidos', () => {
    const graph = buildGraph();
    expect(() => graph.declareEdge('j1', 'ghost')).toThrow(/traceability_node_unknown/);
    expect(() => graph.observeEdge('ghost', 'j1')).toThrow(/traceability_node_unknown/);
  });

  test('tipo de nó inválido é rejeitado', () => {
    const graph = new TraceabilityGraph();
    expect(() => graph.addNode({ id: 'n1', type: 'alien' })).toThrow(/traceability_node_type_invalid/);
  });

  test('findOrphans: nós sem ligação a journey/wave', () => {
    const graph = buildGraph();
    graph.declareEdge('j1', 'p1');
    graph.declareEdge('p1', 'a1');
    // e1 e x1 não têm ligação nenhuma com a jornada.
    expect(graph.findOrphans().sort()).toEqual(['e1', 'x1']);
  });

  test('findOrphans: alcançabilidade bidirecional liga nós a montante da jornada', () => {
    const graph = buildGraph();
    graph.declareEdge('e1', 'j1'); // evidência aponta para a jornada
    expect(graph.findOrphans().sort()).toEqual(['a1', 'p1', 'x1']);
  });

  test('markStale marca apenas arestas CONFIRMED com endpoint alterado', () => {
    const graph = buildGraph();
    graph.declareEdge('j1', 'p1').observeEdge('j1', 'p1');
    graph.declareEdge('p1', 'a1').observeEdge('p1', 'a1');
    graph.computeEdgeStatuses({ executed: true });
    const marked = graph.markStale(['a1']);
    expect(marked).toEqual([{ from: 'p1', to: 'a1' }]);
    const statuses = graph.computeEdgeStatuses({ executed: true });
    expect(statuses.find((s) => s.from === 'p1' && s.to === 'a1').status).toBe(EDGE_STATUSES.STALE);
    expect(statuses.find((s) => s.from === 'j1' && s.to === 'p1').status).toBe(EDGE_STATUSES.CONFIRMED);
  });

  test('propagateImpact alcança jornadas, paths, seeds, outcomes e evidências', () => {
    const graph = buildGraph();
    graph.addNode({ id: 's1', type: 'seed' });
    graph.addNode({ id: 'o1', type: 'outcome' });
    graph.declareEdge('j1', 'p1');
    graph.declareEdge('p1', 'a1');
    graph.declareEdge('s1', 'j1');
    graph.declareEdge('p1', 'o1');
    graph.declareEdge('o1', 'e1');
    const affected = graph.propagateImpact(['a1']);
    expect([...affected].sort()).toEqual(['a1', 'e1', 'j1', 'o1', 'p1', 's1']);
    expect(affected.has('x1')).toBe(false);
  });

  test('propagateImpact termina em grafo cíclico (sem loop infinito)', () => {
    const graph = new TraceabilityGraph();
    graph.addNode({ id: 'j1', type: 'journey' });
    graph.addNode({ id: 'n1', type: 'state' });
    graph.addNode({ id: 'n2', type: 'state' });
    graph.addNode({ id: 'n3', type: 'state' });
    graph.declareEdge('j1', 'n1');
    graph.declareEdge('n1', 'n2');
    graph.declareEdge('n2', 'n3');
    graph.declareEdge('n3', 'n1'); // ciclo
    const affected = graph.propagateImpact(['n2']);
    expect(affected.size).toBe(4);
    expect(graph.findOrphans()).toEqual([]);
  });
});
