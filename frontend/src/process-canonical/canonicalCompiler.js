import { normalizeCanonicalProcessDefinition } from './canonicalNormalizer';
import { validateCanonicalProcessDefinition } from './canonicalValidator';

function buildAdjacency(edges) {
  const adjacency = {};
  edges
    .slice()
    .sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return (a.priority ?? 0) - (b.priority ?? 0);
    })
    .forEach((edge) => {
      if (!adjacency[edge.source]) adjacency[edge.source] = [];
      adjacency[edge.source].push({
        id: edge.id,
        target: edge.target,
        condition: edge.condition || null,
        priority: edge.priority ?? 0,
        eventTrigger: edge.eventTrigger ?? null,
        metadata: edge.metadata || {},
      });
    });
  return adjacency;
}

function buildExecutionGraph(canonical) {
  return {
    nodesById: Object.fromEntries(canonical.nodes.map((node) => [node.id, node])),
    edgesBySource: buildAdjacency(canonical.edges),
    startNode: canonical.entrypoints[0] || canonical.nodes.find((node) => node.type === 'start')?.id || null,
  };
}

export function compileCanonicalProcessDefinition(definition) {
  const canonical = normalizeCanonicalProcessDefinition(definition);
  const validation = validateCanonicalProcessDefinition(canonical);

  return {
    id: canonical.id,
    name: canonical.name,
    version: canonical.version,
    metadata: canonical.metadata,
    canonical,
    nodeMap: Object.fromEntries(canonical.nodes.map((node) => [node.id, node])),
    edgeMap: Object.fromEntries(canonical.edges.map((edge) => [edge.id, edge])),
    adjacency: buildAdjacency(canonical.edges),
    executionGraph: buildExecutionGraph(canonical),
    entrypoints: canonical.entrypoints.slice(),
    policies: canonical.policies,
    aiConfig: canonical.aiConfig,
    operationalConfig: canonical.operationalConfig,
    validation,
  };
}
