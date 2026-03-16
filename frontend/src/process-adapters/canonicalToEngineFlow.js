import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { inferEngineType } from './adapterShared';

function buildNextFromEdges(edges) {
  const bySource = new Map();
  edges.forEach((edge) => {
    if (!bySource.has(edge.source)) bySource.set(edge.source, []);
    bySource.get(edge.source).push(edge);
  });

  const nextByNodeId = new Map();
  bySource.forEach((sourceEdges, sourceId) => {
    const byPort = new Map();
    sourceEdges
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .forEach((edge) => {
        const port = String(edge.metadata?.sourcePort || 'out');
        if (!byPort.has(port)) byPort.set(port, []);
        byPort.get(port).push(edge.target);
      });

    if (byPort.size === 1 && byPort.has('out')) {
      const targets = byPort.get('out');
      nextByNodeId.set(sourceId, targets.length === 1 ? targets[0] : targets);
      return;
    }

    const nextObject = {};
    byPort.forEach((targets, port) => {
      nextObject[port] = targets.length === 1 ? targets[0] : targets;
    });
    nextByNodeId.set(sourceId, nextObject);
  });

  return nextByNodeId;
}

export function canonicalToEngineFlow(definition, meta = {}) {
  const canonical = normalizeCanonicalProcessDefinition(definition);
  const nextByNodeId = buildNextFromEdges(canonical.edges);
  const positions = {};

  const nodes = canonical.nodes.map((node) => {
    const type = inferEngineType(node);
    const layoutPosition = node?.observability?.layout?.position;
    if (Array.isArray(layoutPosition) && layoutPosition.length >= 2) {
      positions[node.id] = [Number(layoutPosition[0]) || 0, Number(layoutPosition[1]) || 0];
    }

    return {
      id: node.id,
      type,
      config: node.config || {},
      next: nextByNodeId.get(node.id) ?? null,
    };
  });

  const flowDefinition = {
    tenantId: meta?.tenantId || canonical.metadata?.tenantId || 'demo-tenant',
    id: meta?.id || canonical.id || 'canonical-flow',
    name: meta?.name || canonical.name || 'Canonical Flow',
    version: Number.isFinite(Number(meta?.version)) ? Number(meta.version) : canonical.version || 1,
    kind: meta?.kind || canonical.metadata?.kind || 'chat',
    nodes,
    metadata: {
      ...(canonical.metadata || {}),
      positions,
      canonical: {
        entrypoints: canonical.entrypoints.slice(),
      },
    },
  };

  return {
    ...flowDefinition,
    flowDefinition,
  };
}
