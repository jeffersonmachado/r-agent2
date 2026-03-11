import { CANONICAL_NODE_TYPES } from '../process-canonical/canonicalTypes';
import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';

const CANONICAL_TO_ENGINE_TYPE = Object.freeze({
  [CANONICAL_NODE_TYPES.START]: 'start',
  [CANONICAL_NODE_TYPES.END]: 'end',
  [CANONICAL_NODE_TYPES.TASK_SERVICE]: 'api',
  [CANONICAL_NODE_TYPES.TASK_AI]: 'ai_task',
  [CANONICAL_NODE_TYPES.TASK_SCRIPT]: 'set_variable',
  [CANONICAL_NODE_TYPES.TASK_USER]: 'handoff',
  [CANONICAL_NODE_TYPES.TASK_MESSAGE_SEND]: 'message',
  [CANONICAL_NODE_TYPES.TASK_MESSAGE_RECEIVE]: 'user_input',
  [CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE]: 'router',
  [CANONICAL_NODE_TYPES.WAIT_TIMER]: 'delay',
  [CANONICAL_NODE_TYPES.CALL_SUBPROCESS]: 'subflow',
  [CANONICAL_NODE_TYPES.FALLBACK]: 'fallback',
  [CANONICAL_NODE_TYPES.VARIABLE_SET]: 'set_variable',
  [CANONICAL_NODE_TYPES.UTILITY_TRANSFORM]: 'set_variable',
  [CANONICAL_NODE_TYPES.UTILITY_TIME]: 'get_current_time',
  [CANONICAL_NODE_TYPES.UTILITY_UUID]: 'generate_uuid',
  [CANONICAL_NODE_TYPES.UTILITY_RANDOM]: 'random_number',
});

function mapCanonicalTypeToEngine(type, report, nodeId) {
  const mapped = CANONICAL_TO_ENGINE_TYPE[type];
  if (mapped) return mapped;

  report.warnings.push({
    code: 'canonical_to_engine_unmapped_node_type',
    message: `Canonical node ${nodeId} type "${type}" has no direct legacy mapping. Using api node.`,
    nodeIds: [nodeId],
  });
  return 'api';
}

function groupEdgesBySource(edges) {
  const out = new Map();
  edges.forEach((edge) => {
    if (!out.has(edge.source)) out.set(edge.source, []);
    out.get(edge.source).push(edge);
  });

  out.forEach((value, key) => {
    out.set(
      key,
      value.slice().sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0)),
    );
  });

  return out;
}

function resolveGatewayNext(edges) {
  if (!Array.isArray(edges) || edges.length === 0) return null;
  if (edges.length === 1 && !edges[0].condition) return edges[0].target;

  const nextMap = {};
  edges.forEach((edge, index) => {
    const portFromCondition = edge?.condition?.port;
    const key = (typeof portFromCondition === 'string' && portFromCondition.trim())
      ? portFromCondition.trim()
      : (index === edges.length - 1 ? 'default' : `rule_${index}`);
    nextMap[key] = edge.target;
  });

  return nextMap;
}

function resolveGenericNext(edges) {
  if (!Array.isArray(edges) || edges.length === 0) return null;
  if (edges.length === 1) return edges[0].target;
  return edges.map((edge) => edge.target);
}

function buildNodeConfig(canonicalNode, engineType) {
  const base = canonicalNode?.config && typeof canonicalNode.config === 'object'
    ? { ...canonicalNode.config }
    : {};

  if (engineType === 'handoff') {
    base.queue = canonicalNode?.humanHandoffPolicy?.queue || base.queue || null;
  }

  if (engineType === 'delay' && !base.ms) {
    base.ms = Number.isFinite(Number(canonicalNode?.timeoutPolicy?.timeoutMs))
      ? Number(canonicalNode.timeoutPolicy.timeoutMs)
      : 0;
  }

  if (engineType === 'ai_task') {
    base.provider = canonicalNode?.aiPolicy?.provider || base.provider || null;
    base.model = canonicalNode?.aiPolicy?.model || base.model || null;
    if (Number.isFinite(Number(canonicalNode?.aiPolicy?.temperature))) {
      base.temperature = Number(canonicalNode.aiPolicy.temperature);
    }
  }

  if (engineType === 'user_input' && !base.variable) {
    base.variable = 'user_input';
  }

  return base;
}

export function canonicalToEngineFlow(canonicalProcessDefinition = {}, options = {}) {
  const normalized = normalizeCanonicalProcessDefinition(canonicalProcessDefinition, options);
  const canonical = normalized.canonicalProcessDefinition;

  const report = {
    warnings: [...normalized.report.warnings],
  };

  const edgesBySource = groupEdgesBySource(Array.isArray(canonical.edges) ? canonical.edges : []);

  const nodes = (canonical.nodes || []).map((node) => {
    const engineType = mapCanonicalTypeToEngine(node.type, report, node.id);
    const outgoing = edgesBySource.get(node.id) || [];

    const next = node.type === CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE
      ? resolveGatewayNext(outgoing)
      : resolveGenericNext(outgoing);

    return {
      id: String(node.id),
      type: engineType,
      config: buildNodeConfig(node, engineType),
      next,
    };
  });

  const flowDefinition = {
    tenantId: options.tenantId || canonical.metadata?.tenantId || 'demo-tenant',
    id: canonical.id,
    name: canonical.name,
    version: Number.isFinite(Number(canonical.version)) ? Number(canonical.version) : 1,
    nodes,
    metadata: {
      ...(canonical.metadata && typeof canonical.metadata === 'object' ? canonical.metadata : {}),
      canonical: {
        id: canonical.id,
        version: canonical.version,
      },
    },
  };

  return {
    flowDefinition,
    report,
  };
}

export default canonicalToEngineFlow;
