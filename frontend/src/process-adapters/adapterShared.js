import {
  getCanonicalTypeForNodeType,
  getDefaultEngineTypeForCanonicalType,
  getDefaultReteTypeForCanonicalType,
} from '../process-canonical/canonicalTypes';

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function buildReteNodeIdMap(nodesObj) {
  const map = new Map();
  Object.values(nodesObj || {}).forEach((node) => {
    if (!node || typeof node.id === 'undefined') return;
    map.set(String(node.id), String(node?.data?.__engineId || node.id));
  });
  return map;
}

export function rewriteConfigNodeReferences(nodeType, config, remapId) {
  const cloned = cloneJson(config) || {};
  const normalizedType = String(nodeType || '').trim();

  if ((normalizedType === 'router' || normalizedType === 'voice_branch') && Array.isArray(cloned.rules)) {
    cloned.rules = cloned.rules.map((rule) => (
      rule && rule.next
        ? { ...rule, next: remapId(rule.next) }
        : rule
    ));
  }

  if (normalizedType === 'schedule_router') {
    if (Array.isArray(cloned.schedules)) {
      cloned.schedules = cloned.schedules.map((schedule) => (
        schedule && schedule.next
          ? { ...schedule, next: remapId(schedule.next) }
          : schedule
      ));
    }
    if (cloned.defaultNext) cloned.defaultNext = remapId(cloned.defaultNext);
  }

  return cloned;
}

export function extractReteEdges(nodesObj, reteToCanonicalId) {
  const edges = [];
  Object.values(nodesObj || {}).forEach((node) => {
    if (!node || typeof node.id === 'undefined') return;
    const sourceId = reteToCanonicalId(String(node.id));
    const outputs = node.outputs && typeof node.outputs === 'object' ? node.outputs : {};
    Object.entries(outputs).forEach(([outputKey, output]) => {
      const connections = Array.isArray(output?.connections) ? output.connections : [];
      connections.forEach((connection, index) => {
        const targetReteId = connection?.node != null ? String(connection.node) : null;
        if (!targetReteId) return;
        const targetId = reteToCanonicalId(targetReteId);
        edges.push({
          id: `${sourceId}:${outputKey}:${targetId}:${index}`,
          source: sourceId,
          target: targetId,
          condition: null,
          priority: index,
          eventTrigger: null,
          metadata: {
            sourcePort: outputKey,
            targetInput: connection?.input || null,
            sourceFormat: 'rete',
          },
        });
      });
    });
  });
  return edges;
}

export function buildCanonicalLabel(nodeType, fallbackLabel) {
  return fallbackLabel || String(nodeType || 'Node');
}

export function inferCanonicalSubtype(nodeType) {
  return String(nodeType || '').trim() || null;
}

export function inferCanonicalType(nodeType) {
  return getCanonicalTypeForNodeType(nodeType);
}

export function inferReteType(node) {
  return node?.metadata?.adapter?.reteType
    || node?.subtype
    || getDefaultReteTypeForCanonicalType(node?.type);
}

export function inferEngineType(node) {
  return node?.metadata?.adapter?.engineType
    || node?.subtype
    || getDefaultEngineTypeForCanonicalType(node?.type);
}
