import {
  isCanonicalNodeType,
  createCanonicalIssue,
  ISSUE_SEVERITY,
} from './canonicalTypes';
import {
  cloneDefaultProcessPolicies,
  defaultNodeLabel,
  resolveNodePolicies,
  buildDefaultMetadata,
} from './canonicalDefaults';

function asString(value, fallback = null) {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toPredictableId(prefix, value, index) {
  const candidate = asString(value, null);
  if (candidate) return candidate;
  return `${prefix}_${index + 1}`;
}

function buildEdgeId(source, target, index) {
  return `edge_${source}_to_${target}_${index + 1}`;
}

function normalizeEdge(edge, index, warnings) {
  const source = asString(edge?.source, null);
  const target = asString(edge?.target, null);
  if (!source || !target) {
    warnings.push(createCanonicalIssue({
      code: 'canonical_edge_missing_endpoint',
      message: 'Edge without source or target was ignored during normalization.',
      severity: ISSUE_SEVERITY.WARNING,
      details: { edge },
    }));
    return null;
  }

  return {
    id: asString(edge?.id, buildEdgeId(source, target, index)),
    source,
    target,
    condition: edge?.condition ?? null,
    priority: Number.isFinite(Number(edge?.priority)) ? Number(edge.priority) : index,
    eventTrigger: edge?.eventTrigger || null,
    metadata: edge?.metadata && typeof edge.metadata === 'object' ? edge.metadata : {},
  };
}

function inferEdgesFromLegacyNext(nodes = []) {
  const inferred = [];

  nodes.forEach((node, nodeIndex) => {
    const source = asString(node?.id, `node_${nodeIndex + 1}`);
    const next = node?.next;

    if (typeof next === 'string' && next.trim()) {
      inferred.push({
        source,
        target: next.trim(),
        priority: 0,
      });
      return;
    }

    if (Array.isArray(next)) {
      next.forEach((target, idx) => {
        const normalizedTarget = asString(target, null);
        if (!normalizedTarget) return;
        inferred.push({
          source,
          target: normalizedTarget,
          priority: idx,
        });
      });
      return;
    }

    if (next && typeof next === 'object') {
      Object.entries(next).forEach(([port, target], idx) => {
        const normalizedTarget = asString(target, null);
        if (!normalizedTarget) return;
        inferred.push({
          source,
          target: normalizedTarget,
          priority: idx,
          condition: {
            kind: 'port',
            port,
            expression: `port:${port}`,
          },
        });
      });
    }
  });

  return inferred;
}

export function normalizeCanonicalProcessDefinition(input = {}, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const warnings = [];

  const rawNodes = asArray(raw.nodes);
  const normalizedNodes = rawNodes.map((rawNode, index) => {
    const nodeId = toPredictableId('node', rawNode?.id, index);
    const nodeType = asString(rawNode?.type, 'task.script');

    if (!isCanonicalNodeType(nodeType)) {
      warnings.push(createCanonicalIssue({
        code: 'canonical_unknown_node_type',
        message: `Node ${nodeId} has unsupported canonical type "${nodeType}".`,
        severity: ISSUE_SEVERITY.WARNING,
        nodeIds: [nodeId],
      }));
    }

    const processPolicies = raw.policies && typeof raw.policies === 'object'
      ? raw.policies
      : cloneDefaultProcessPolicies();

    const resolvedPolicies = resolveNodePolicies(rawNode, processPolicies);

    return {
      id: nodeId,
      type: nodeType,
      subtype: asString(rawNode?.subtype, null),
      label: asString(rawNode?.label, defaultNodeLabel(nodeType, nodeId)),
      config: rawNode?.config && typeof rawNode.config === 'object' ? rawNode.config : {},
      inputSchema: rawNode?.inputSchema && typeof rawNode.inputSchema === 'object' ? rawNode.inputSchema : null,
      outputSchema: rawNode?.outputSchema && typeof rawNode.outputSchema === 'object' ? rawNode.outputSchema : null,
      retryPolicy: resolvedPolicies.retryPolicy,
      timeoutPolicy: resolvedPolicies.timeoutPolicy,
      fallbackPolicy: resolvedPolicies.fallbackPolicy,
      humanHandoffPolicy: resolvedPolicies.humanHandoffPolicy,
      aiPolicy: resolvedPolicies.aiPolicy,
      observability: resolvedPolicies.observability,
      metadata: rawNode?.metadata && typeof rawNode.metadata === 'object' ? rawNode.metadata : {},
    };
  });

  const rawEdges = asArray(raw.edges);
  const edgesSource = rawEdges.length > 0 ? rawEdges : inferEdgesFromLegacyNext(rawNodes);

  const normalizedEdges = edgesSource
    .map((edge, index) => normalizeEdge(edge, index, warnings))
    .filter(Boolean);

  const nodeIdSet = new Set(normalizedNodes.map((node) => node.id));
  const filteredEdges = normalizedEdges.filter((edge) => {
    const valid = nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target);
    if (!valid) {
      warnings.push(createCanonicalIssue({
        code: 'canonical_edge_unknown_node',
        message: `Edge ${edge.id} references unknown nodes and was ignored.`,
        severity: ISSUE_SEVERITY.WARNING,
        details: {
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        },
      }));
    }
    return valid;
  });

  let entrypoints = asArray(raw.entrypoints)
    .map((value) => asString(value, null))
    .filter(Boolean)
    .filter((entrypoint) => nodeIdSet.has(entrypoint));

  if (entrypoints.length === 0) {
    entrypoints = normalizedNodes
      .filter((node) => node.type === 'start')
      .map((node) => node.id);
  }

  if (entrypoints.length === 0 && normalizedNodes.length > 0) {
    entrypoints = [normalizedNodes[0].id];
    warnings.push(createCanonicalIssue({
      code: 'canonical_entrypoint_inferred',
      message: `Entrypoint not provided. Using first node (${normalizedNodes[0].id}).`,
      severity: ISSUE_SEVERITY.WARNING,
      nodeIds: [normalizedNodes[0].id],
    }));
  }

  const processPolicies = {
    ...cloneDefaultProcessPolicies(),
    ...(raw.policies && typeof raw.policies === 'object' ? raw.policies : {}),
  };

  const normalized = {
    id: asString(raw.id, options.defaultProcessId || 'canonical_process'),
    name: asString(raw.name, 'Canonical Process'),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
    metadata: buildDefaultMetadata(raw.metadata),
    nodes: normalizedNodes,
    edges: filteredEdges,
    entrypoints,
    policies: processPolicies,
    aiConfig: raw.aiConfig && typeof raw.aiConfig === 'object' ? raw.aiConfig : {},
    operationalConfig: raw.operationalConfig && typeof raw.operationalConfig === 'object'
      ? raw.operationalConfig
      : {},
  };

  return {
    canonicalProcessDefinition: normalized,
    report: {
      warnings,
      normalizedNodeCount: normalizedNodes.length,
      normalizedEdgeCount: filteredEdges.length,
    },
  };
}

export default normalizeCanonicalProcessDefinition;
