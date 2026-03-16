import { getNodeSchema } from '../editor/nodeSchemas';
import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { extractReteEdges, buildCanonicalLabel, buildReteNodeIdMap, inferCanonicalSubtype, inferCanonicalType, rewriteConfigNodeReferences } from './adapterShared';

export function reteToCanonical(reteJson, meta = {}) {
  const nodesObj = reteJson?.nodes && typeof reteJson.nodes === 'object' ? reteJson.nodes : {};
  const reteIdToCanonicalId = buildReteNodeIdMap(nodesObj);
  const resolveCanonicalId = (reteId) => reteIdToCanonicalId.get(String(reteId)) || String(reteId);

  const nodes = Object.values(nodesObj).map((node, index) => {
    const reteType = node?.data?.type || 'unknown';
    const schema = getNodeSchema(reteType);
    const canonicalId = resolveCanonicalId(String(node.id));
    const config = rewriteConfigNodeReferences(
      reteType,
      node?.data?.config || {},
      (value) => resolveCanonicalId(String(value)),
    );

    return {
      id: canonicalId,
      type: inferCanonicalType(reteType),
      subtype: inferCanonicalSubtype(reteType),
      label: buildCanonicalLabel(schema?.label || reteType, schema?.label || `Node ${index + 1}`),
      config,
      inputSchema: {},
      outputSchema: {},
      metadata: {
        adapter: {
          sourceFormat: 'rete',
          reteType,
          engineType: node?.data?.type || reteType,
          reteNodeId: String(node.id),
          engineId: node?.data?.__engineId ? String(node.data.__engineId) : null,
        },
      },
      observability: {
        layout: Array.isArray(node?.position) && node.position.length >= 2
          ? { position: [Number(node.position[0]) || 0, Number(node.position[1]) || 0] }
          : null,
      },
    };
  });

  const edges = extractReteEdges(nodesObj, resolveCanonicalId);

  const canonicalProcessDefinition = normalizeCanonicalProcessDefinition({
    id: String(meta?.id || reteJson?.id || 'canonical-from-rete'),
    name: String(meta?.name || 'Canonical Process'),
    version: Number.isFinite(Number(meta?.version)) ? Number(meta.version) : 1,
    metadata: {
      sourceFormat: 'rete',
      tenantId: meta?.tenantId || null,
      kind: meta?.kind || null,
    },
    nodes,
    edges,
    entrypoints: nodes.filter((node) => node.type === 'start').map((node) => node.id),
  });

  return {
    ...canonicalProcessDefinition,
    canonicalProcessDefinition,
  };
}
