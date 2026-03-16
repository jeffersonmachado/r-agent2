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

function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Compila um processo canonico retornando relatorio de validacao e a definicao
 * compilada com indexes pre-calculados para uso em runtime.
 */
export function compileCanonicalProcess(definition) {
  const canonical = normalizeCanonicalProcessDefinition(definition);
  const report = validateCanonicalProcessDefinition(canonical);

  const nodeById = Object.fromEntries(canonical.nodes.map((n) => [n.id, n]));

  const outgoingByNodeId = Object.fromEntries(canonical.nodes.map((n) => [n.id, []]));
  canonical.edges.forEach((edge) => {
    if (outgoingByNodeId[edge.source]) {
      outgoingByNodeId[edge.source].push(edge);
    } else {
      outgoingByNodeId[edge.source] = [edge];
    }
  });

  const versionHash = djb2Hash(
    JSON.stringify({ id: canonical.id, version: canonical.version, nodes: canonical.nodes, edges: canonical.edges })
  );

  return {
    report,
    compiledProcessDefinition: {
      format: 'canonical-compiled',
      versionHash,
      nodeById,
      outgoingByNodeId,
      entrypoints: canonical.entrypoints.slice(),
    },
  };
}
