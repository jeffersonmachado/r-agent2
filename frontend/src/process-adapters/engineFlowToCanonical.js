import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { CANONICAL_NODE_TYPES } from '../process-canonical/canonicalTypes';

const ENGINE_TO_CANONICAL_TYPE = Object.freeze({
  start: CANONICAL_NODE_TYPES.START,
  end: CANONICAL_NODE_TYPES.END,
  message: CANONICAL_NODE_TYPES.TASK_MESSAGE_SEND,
  user_input: CANONICAL_NODE_TYPES.TASK_MESSAGE_RECEIVE,
  router: CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE,
  options: CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE,
  schedule_router: CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE,
  set_variable: CANONICAL_NODE_TYPES.VARIABLE_SET,
  handoff: CANONICAL_NODE_TYPES.TASK_USER,
  ai: CANONICAL_NODE_TYPES.TASK_AI,
  ai_task: CANONICAL_NODE_TYPES.TASK_AI,
  api: CANONICAL_NODE_TYPES.TASK_SERVICE,
  subflow: CANONICAL_NODE_TYPES.CALL_SUBPROCESS,
  delay: CANONICAL_NODE_TYPES.WAIT_TIMER,
  fallback: CANONICAL_NODE_TYPES.FALLBACK,
  get_flow_info: CANONICAL_NODE_TYPES.TASK_SERVICE,
  get_queue_status: CANONICAL_NODE_TYPES.TASK_SERVICE,
  get_config_value: CANONICAL_NODE_TYPES.TASK_SERVICE,
  list_flows: CANONICAL_NODE_TYPES.TASK_SERVICE,
  get_current_time: CANONICAL_NODE_TYPES.UTILITY_TIME,
  format_date: CANONICAL_NODE_TYPES.UTILITY_TIME,
  generate_uuid: CANONICAL_NODE_TYPES.UTILITY_UUID,
  random_number: CANONICAL_NODE_TYPES.UTILITY_RANDOM,
  get_user_info: CANONICAL_NODE_TYPES.TASK_SERVICE,
});

function mapEngineTypeToCanonical(type, report, nodeId) {
  const key = String(type || '').trim();
  const mapped = ENGINE_TO_CANONICAL_TYPE[key];
  if (mapped) return mapped;

  report.warnings.push({
    code: 'engine_to_canonical_unmapped_node_type',
    message: `Node ${nodeId} type "${key}" has no canonical mapping. Using task.script.`,
    nodeIds: [nodeId],
  });
  return CANONICAL_NODE_TYPES.TASK_SCRIPT;
}

function asArrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTarget(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function buildEdgesFromNext(node, edges) {
  const source = String(node.id);
  const next = node.next;

  if (typeof next === 'string') {
    const target = normalizeTarget(next);
    if (!target) return;
    edges.push({ source, target, priority: 0, metadata: { source: 'next:string' } });
    return;
  }

  if (Array.isArray(next)) {
    next.forEach((targetValue, index) => {
      const target = normalizeTarget(targetValue);
      if (!target) return;
      edges.push({ source, target, priority: index, metadata: { source: 'next:array' } });
    });
    return;
  }

  if (next && typeof next === 'object') {
    Object.entries(next).forEach(([port, targetValue], index) => {
      const target = normalizeTarget(targetValue);
      if (!target) return;
      edges.push({
        source,
        target,
        priority: index,
        condition: {
          kind: 'port',
          port,
          expression: `port:${port}`,
        },
        metadata: { source: 'next:object' },
      });
    });
  }
}

function buildEdgesFromRules(node, edges) {
  const source = String(node.id);

  asArrayValue(node?.config?.rules).forEach((rule, index) => {
    const target = normalizeTarget(rule?.next);
    if (!target) return;

    edges.push({
      source,
      target,
      priority: index,
      condition: {
        kind: 'rule',
        expression: typeof rule?.condition?.op === 'string'
          ? rule.condition.op
          : `rule_${index + 1}`,
        payload: rule?.condition || null,
      },
      metadata: { source: 'config.rules' },
    });
  });
}

function buildEdgesFromSchedules(node, edges) {
  const source = String(node.id);

  asArrayValue(node?.config?.schedules).forEach((schedule, index) => {
    const target = normalizeTarget(schedule?.next);
    if (!target) return;

    edges.push({
      source,
      target,
      priority: index,
      condition: {
        kind: 'schedule',
        expression: schedule?.condition || `schedule_${index + 1}`,
        payload: schedule || null,
      },
      metadata: { source: 'config.schedules' },
    });
  });
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.source}|${edge.target}|${JSON.stringify(edge.condition || null)}|${edge.priority}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildNodePolicies(node) {
  const type = String(node?.type || '').trim();
  const config = node?.config && typeof node.config === 'object' ? node.config : {};

  const retryPolicy = {
    maxAttempts: Number.isFinite(Number(config.retryAttempts)) ? Number(config.retryAttempts) : 1,
    backoffMs: Number.isFinite(Number(config.retryBackoffMs)) ? Number(config.retryBackoffMs) : 0,
    strategy: config.retryStrategy || 'none',
  };

  const timeoutPolicy = {
    timeoutMs: Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 0,
    onTimeout: config.onTimeout || 'error',
  };

  const fallbackPolicy = {
    enabled: type === 'fallback' || Boolean(config.enableFallback),
    targetNodeId: config.fallbackTo || null,
    reason: config.reason || null,
  };

  const humanHandoffPolicy = {
    enabled: type === 'handoff',
    queue: config.queue || config.queueName || null,
    priority: config.priority || 'normal',
  };

  const aiPolicy = {
    provider: config.provider || null,
    model: config.model || null,
    temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.2,
    maxTokens: Number.isFinite(Number(config.maxTokens)) ? Number(config.maxTokens) : null,
  };

  return {
    retryPolicy,
    timeoutPolicy,
    fallbackPolicy,
    humanHandoffPolicy,
    aiPolicy,
  };
}

export function engineFlowToCanonical(flowDefinition = {}, options = {}) {
  const report = {
    warnings: [],
    degradedNodes: [],
  };

  const nodes = Array.isArray(flowDefinition?.nodes) ? flowDefinition.nodes : [];
  const canonicalNodes = nodes.map((node, index) => {
    const nodeId = String(node?.id || `node_${index + 1}`);
    const canonicalType = mapEngineTypeToCanonical(node?.type, report, nodeId);
    const policies = buildNodePolicies(node);

    return {
      id: nodeId,
      type: canonicalType,
      subtype: String(node?.type || '').trim() || null,
      label: String(node?.config?.label || node?.type || `Node ${index + 1}`),
      config: node?.config && typeof node.config === 'object' ? node.config : {},
      inputSchema: node?.config?.inputSchema || null,
      outputSchema: node?.config?.outputSchema || null,
      retryPolicy: policies.retryPolicy,
      timeoutPolicy: policies.timeoutPolicy,
      fallbackPolicy: policies.fallbackPolicy,
      humanHandoffPolicy: policies.humanHandoffPolicy,
      aiPolicy: policies.aiPolicy,
      observability: {
        trace: true,
        metrics: true,
        tags: Array.isArray(node?.config?.tags) ? node.config.tags : [],
      },
      metadata: {
        legacyEngineType: String(node?.type || 'unknown'),
      },
    };
  });

  const edges = [];
  nodes.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    buildEdgesFromNext(node, edges);
    buildEdgesFromRules(node, edges);
    buildEdgesFromSchedules(node, edges);
  });

  const dedupedEdges = dedupeEdges(edges);

  const candidate = {
    id: flowDefinition?.id || options.defaultProcessId || 'canonical_from_engine',
    name: flowDefinition?.name || 'Canonical From Engine Flow',
    version: Number.isFinite(Number(flowDefinition?.version)) ? Number(flowDefinition.version) : 1,
    metadata: {
      source: 'engine-flow',
      tenantId: flowDefinition?.tenantId || null,
      legacyMetadata: flowDefinition?.metadata || {},
    },
    nodes: canonicalNodes,
    edges: dedupedEdges,
    entrypoints: canonicalNodes
      .filter((node) => node.type === CANONICAL_NODE_TYPES.START)
      .map((node) => node.id),
    policies: {
      retry: { maxAttempts: 1, backoffMs: 0, strategy: 'none' },
      timeout: { timeoutMs: 0, onTimeout: 'error' },
      fallback: { enabled: false, targetNodeId: null, reason: null },
      handoff: { enabled: false, queue: null, priority: 'normal' },
    },
    aiConfig: {},
    operationalConfig: {},
  };

  const normalized = normalizeCanonicalProcessDefinition(candidate, options);

  return {
    canonicalProcessDefinition: normalized.canonicalProcessDefinition,
    report: {
      warnings: [...report.warnings, ...normalized.report.warnings],
      degradedNodes: report.degradedNodes,
      mappedNodeCount: canonicalNodes.length,
      mappedEdgeCount: dedupedEdges.length,
    },
  };
}

export default engineFlowToCanonical;
