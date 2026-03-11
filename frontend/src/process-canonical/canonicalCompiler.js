import { normalizeCanonicalProcessDefinition } from './canonicalNormalizer';
import { validateCanonicalProcess } from './canonicalValidator';
import { resolveNodePolicies } from './canonicalDefaults';

function stableJson(value) {
  function normalize(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);
    const out = {};
    Object.keys(v).sort().forEach((key) => {
      out[key] = normalize(v[key]);
    });
    return out;
  }

  return JSON.stringify(normalize(value));
}

function hashString(raw) {
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function buildIndexes(nodes, edges) {
  const nodeById = {};
  const outgoingByNodeId = {};
  const incomingByNodeId = {};

  nodes.forEach((node) => {
    nodeById[node.id] = node;
    outgoingByNodeId[node.id] = [];
    incomingByNodeId[node.id] = [];
  });

  edges.forEach((edge) => {
    if (!outgoingByNodeId[edge.source]) outgoingByNodeId[edge.source] = [];
    if (!incomingByNodeId[edge.target]) incomingByNodeId[edge.target] = [];
    outgoingByNodeId[edge.source].push(edge);
    incomingByNodeId[edge.target].push(edge);
  });

  Object.keys(outgoingByNodeId).forEach((nodeId) => {
    outgoingByNodeId[nodeId] = outgoingByNodeId[nodeId]
      .slice()
      .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  });

  return {
    nodeById,
    outgoingByNodeId,
    incomingByNodeId,
  };
}

export function compileCanonicalProcess(canonicalProcessDefinition, options = {}) {
  const normalizeResult = normalizeCanonicalProcessDefinition(
    canonicalProcessDefinition,
    options,
  );
  const normalized = normalizeResult.canonicalProcessDefinition;
  const validation = validateCanonicalProcess(normalized);

  if (options.strict === true && validation.errors.length > 0) {
    const error = new Error('compileCanonicalProcess: canonical validation failed');
    error.code = 'CANONICAL_VALIDATION_FAILED';
    error.details = validation;
    throw error;
  }

  const processPolicies = normalized.policies && typeof normalized.policies === 'object'
    ? normalized.policies
    : {};

  const compiledNodes = normalized.nodes.map((node) => {
    const resolved = resolveNodePolicies(node, processPolicies);
    return {
      ...node,
      retryPolicy: resolved.retryPolicy,
      timeoutPolicy: resolved.timeoutPolicy,
      fallbackPolicy: resolved.fallbackPolicy,
      humanHandoffPolicy: resolved.humanHandoffPolicy,
      aiPolicy: resolved.aiPolicy,
      observability: resolved.observability,
    };
  });

  const indexes = buildIndexes(compiledNodes, normalized.edges);

  const versionHash = hashString(stableJson({
    id: normalized.id,
    version: normalized.version,
    nodes: compiledNodes,
    edges: normalized.edges,
    entrypoints: normalized.entrypoints,
    policies: normalized.policies,
  }));

  const compiledProcessDefinition = {
    format: 'canonical-compiled',
    id: normalized.id,
    name: normalized.name,
    version: normalized.version,
    versionHash,
    metadata: {
      ...normalized.metadata,
      compiledAt: new Date().toISOString(),
    },
    nodes: compiledNodes,
    edges: normalized.edges,
    entrypoints: normalized.entrypoints,
    policies: normalized.policies,
    aiConfig: normalized.aiConfig,
    operationalConfig: normalized.operationalConfig,
    nodeById: indexes.nodeById,
    outgoingByNodeId: indexes.outgoingByNodeId,
    incomingByNodeId: indexes.incomingByNodeId,
  };

  return {
    compiledProcessDefinition,
    report: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: [...normalizeResult.report.warnings, ...validation.warnings],
      suggestions: validation.suggestions,
      summary: {
        errorCount: validation.errors.length,
        warningCount: normalizeResult.report.warnings.length + validation.warnings.length,
        suggestionCount: validation.suggestions.length,
      },
    },
  };
}

export default compileCanonicalProcess;
