import {
  DEFAULT_AI_CONFIG,
  DEFAULT_CANONICAL_VERSION,
  DEFAULT_OPERATIONAL_CONFIG,
  DEFAULT_PROCESS_POLICIES,
  cloneDefault,
  createDefaultNodePolicies,
} from './canonicalDefaults';

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function normalizeNode(node, index) {
  const defaults = createDefaultNodePolicies();
  const metadata = normalizeObject(node?.metadata);
  return {
    id: String(node?.id || `canonical-node-${index + 1}`),
    type: String(node?.type || 'utility.transform'),
    subtype: typeof node?.subtype === 'string' ? node.subtype : null,
    label: typeof node?.label === 'string' && node.label.trim() ? node.label : String(node?.id || `Node ${index + 1}`),
    config: normalizeObject(node?.config),
    inputSchema: normalizeObject(node?.inputSchema),
    outputSchema: normalizeObject(node?.outputSchema),
    retryPolicy: { ...defaults.retryPolicy, ...normalizeObject(node?.retryPolicy) },
    timeoutPolicy: { ...defaults.timeoutPolicy, ...normalizeObject(node?.timeoutPolicy) },
    fallbackPolicy: { ...defaults.fallbackPolicy, ...normalizeObject(node?.fallbackPolicy) },
    humanHandoffPolicy: { ...defaults.humanHandoffPolicy, ...normalizeObject(node?.humanHandoffPolicy) },
    aiPolicy: { ...defaults.aiPolicy, ...normalizeObject(node?.aiPolicy) },
    observability: { ...defaults.observability, ...normalizeObject(node?.observability) },
    metadata,
  };
}

function normalizeEdge(edge, index, nodeIds) {
  const source = String(edge?.source || '');
  const target = String(edge?.target || '');
  return {
    id: String(edge?.id || `canonical-edge-${index + 1}`),
    source,
    target,
    condition: normalizeObject(edge?.condition),
    priority: Number.isFinite(Number(edge?.priority)) ? Number(edge.priority) : index,
    eventTrigger: edge?.eventTrigger ?? null,
    metadata: {
      ...normalizeObject(edge?.metadata),
      sourceMissing: source ? !nodeIds.has(source) : true,
      targetMissing: target ? !nodeIds.has(target) : true,
    },
  };
}

export function normalizeCanonicalProcessDefinition(definition) {
  const base = definition && typeof definition === 'object' ? definition : {};
  const nodes = normalizeArray(base.nodes).map((node, index) => normalizeNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeArray(base.edges).map((edge, index) => normalizeEdge(edge, index, nodeIds));
  const entrypoints = normalizeArray(base.entrypoints)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  return {
    id: String(base.id || 'canonical-process'),
    name: typeof base.name === 'string' && base.name.trim() ? base.name : 'Canonical Process',
    version: Number.isFinite(Number(base.version)) ? Number(base.version) : DEFAULT_CANONICAL_VERSION,
    metadata: normalizeObject(base.metadata),
    nodes,
    edges,
    entrypoints: entrypoints.length > 0
      ? Array.from(new Set(entrypoints))
      : nodes.filter((node) => node.type === 'start').map((node) => node.id),
    policies: { ...cloneDefault(DEFAULT_PROCESS_POLICIES), ...normalizeObject(base.policies) },
    aiConfig: { ...cloneDefault(DEFAULT_AI_CONFIG), ...normalizeObject(base.aiConfig) },
    operationalConfig: { ...cloneDefault(DEFAULT_OPERATIONAL_CONFIG), ...normalizeObject(base.operationalConfig) },
  };
}
