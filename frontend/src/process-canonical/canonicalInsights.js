function buildAdjacency(canonical) {
  const adjacency = new Map();
  (canonical?.edges || []).forEach((edge) => {
    const source = String(edge?.source || '');
    if (!source) return;
    if (!adjacency.has(source)) adjacency.set(source, []);
    adjacency.get(source).push(String(edge?.target || ''));
  });
  return adjacency;
}

function collectReachable(canonical) {
  const visited = new Set();
  const adjacency = buildAdjacency(canonical);
  const stack = Array.isArray(canonical?.entrypoints) ? canonical.entrypoints.slice() : [];
  while (stack.length > 0) {
    const nodeId = String(stack.pop() || '');
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    (adjacency.get(nodeId) || []).forEach((target) => {
      if (target && !visited.has(target)) stack.push(target);
    });
  }
  return visited;
}

export function buildCanonicalInsights(canonical) {
  const nodes = Array.isArray(canonical?.nodes) ? canonical.nodes : [];
  const edges = Array.isArray(canonical?.edges) ? canonical.edges : [];
  const reachable = collectReachable(canonical);
  const unreachableNodes = nodes.filter((node) => !reachable.has(String(node.id))).map((node) => String(node.id));
  const branchingNodes = nodes.filter((node) => edges.filter((edge) => String(edge.source) === String(node.id)).length > 1);
  const complexityScore = (
    nodes.length
    + (edges.length * 0.75)
    + (branchingNodes.length * 3)
    + (unreachableNodes.length * 2)
  );

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    unreachableNodes,
    branchingNodes: branchingNodes.map((node) => String(node.id)),
    complexityScore,
    complexityLevel: complexityScore >= 40 ? 'high' : complexityScore >= 20 ? 'medium' : 'low',
  };
}
