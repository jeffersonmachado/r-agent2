import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { inferCanonicalSubtype, inferCanonicalType, rewriteConfigNodeReferences } from './adapterShared';

function pushEdgesForPort(edges, sourceId, port, targetValue) {
  const targets = Array.isArray(targetValue) ? targetValue : [targetValue];
  targets.forEach((target, index) => {
    if (!target) return;
    edges.push({
      id: `${sourceId}:${port}:${target}:${index}`,
      source: sourceId,
      target: String(target),
      condition: null,
      priority: index,
      eventTrigger: null,
      metadata: {
        sourcePort: port,
        sourceFormat: 'engine',
      },
    });
  });
}

export function engineFlowToCanonical(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const positions = flow?.metadata?.positions && typeof flow.metadata.positions === 'object'
    ? flow.metadata.positions
    : {};
  const idSet = new Set(nodes.map((node) => String(node.id)));
  const remap = (value) => (idSet.has(String(value)) ? String(value) : String(value));

  const canonicalNodes = nodes.map((node) => ({
    id: String(node.id),
    type: inferCanonicalType(node.type),
    subtype: inferCanonicalSubtype(node.type),
    label: String(node.type || node.id),
    config: rewriteConfigNodeReferences(node.type, node.config || {}, remap),
    inputSchema: {},
    outputSchema: {},
    metadata: {
      adapter: {
        sourceFormat: 'engine',
        engineType: node.type,
        reteType: node.type,
      },
    },
    observability: Array.isArray(positions[String(node.id)]) && positions[String(node.id)].length >= 2
      ? { layout: { position: [Number(positions[String(node.id)][0]) || 0, Number(positions[String(node.id)][1]) || 0] } }
      : {},
  }));

  const edges = [];
  nodes.forEach((node) => {
    const sourceId = String(node.id);
    const next = node?.next;
    if (!next) return;
    if (typeof next === 'string' || Array.isArray(next)) {
      pushEdgesForPort(edges, sourceId, 'out', next);
      return;
    }
    if (typeof next === 'object') {
      Object.entries(next).forEach(([port, target]) => {
        pushEdgesForPort(edges, sourceId, port, target);
      });
    }
  });

  return normalizeCanonicalProcessDefinition({
    id: String(flow?.id || 'canonical-from-engine'),
    name: String(flow?.name || 'Canonical Process'),
    version: Number.isFinite(Number(flow?.version)) ? Number(flow.version) : 1,
    metadata: {
      sourceFormat: 'engine',
      tenantId: flow?.tenantId || null,
      kind: flow?.kind || null,
    },
    nodes: canonicalNodes,
    edges,
    entrypoints: canonicalNodes.filter((node) => node.type === 'start').map((node) => node.id),
  });
}
