import { CANONICAL_NODE_TYPES } from './canonicalTypes';

export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 1,
  backoffMs: 0,
  strategy: 'none',
});

export const DEFAULT_TIMEOUT_POLICY = Object.freeze({
  timeoutMs: 0,
  onTimeout: 'error',
});

export const DEFAULT_FALLBACK_POLICY = Object.freeze({
  enabled: false,
  targetNodeId: null,
  reason: null,
});

export const DEFAULT_HUMAN_HANDOFF_POLICY = Object.freeze({
  enabled: false,
  queue: null,
  priority: 'normal',
});

export const DEFAULT_AI_POLICY = Object.freeze({
  provider: null,
  model: null,
  temperature: 0.2,
  maxTokens: null,
});

export const DEFAULT_OBSERVABILITY_POLICY = Object.freeze({
  trace: true,
  metrics: true,
  tags: [],
});

export const DEFAULT_PROCESS_POLICIES = Object.freeze({
  retry: DEFAULT_RETRY_POLICY,
  timeout: DEFAULT_TIMEOUT_POLICY,
  fallback: DEFAULT_FALLBACK_POLICY,
  handoff: DEFAULT_HUMAN_HANDOFF_POLICY,
});

export function cloneDefaultProcessPolicies() {
  return JSON.parse(JSON.stringify(DEFAULT_PROCESS_POLICIES));
}

export function defaultNodeLabel(nodeType, nodeId) {
  if (nodeType === CANONICAL_NODE_TYPES.START) return 'Start';
  if (nodeType === CANONICAL_NODE_TYPES.END) return 'End';
  if (nodeType === CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE) return 'Decision';
  if (nodeType === CANONICAL_NODE_TYPES.TASK_AI) return 'AI Task';
  if (nodeType === CANONICAL_NODE_TYPES.WAIT_TIMER) return 'Wait Timer';
  return `Node ${nodeId}`;
}

function mergePolicy(base, override) {
  const source = override && typeof override === 'object' ? override : {};
  return {
    ...base,
    ...source,
  };
}

export function resolveNodePolicies(node = {}, processPolicies = {}) {
  return {
    retryPolicy: mergePolicy(
      mergePolicy(DEFAULT_RETRY_POLICY, processPolicies.retry),
      node.retryPolicy,
    ),
    timeoutPolicy: mergePolicy(
      mergePolicy(DEFAULT_TIMEOUT_POLICY, processPolicies.timeout),
      node.timeoutPolicy,
    ),
    fallbackPolicy: mergePolicy(
      mergePolicy(DEFAULT_FALLBACK_POLICY, processPolicies.fallback),
      node.fallbackPolicy,
    ),
    humanHandoffPolicy: mergePolicy(
      mergePolicy(DEFAULT_HUMAN_HANDOFF_POLICY, processPolicies.handoff),
      node.humanHandoffPolicy,
    ),
    aiPolicy: mergePolicy(DEFAULT_AI_POLICY, node.aiPolicy),
    observability: {
      ...DEFAULT_OBSERVABILITY_POLICY,
      ...(node.observability && typeof node.observability === 'object' ? node.observability : {}),
      tags: Array.isArray(node?.observability?.tags)
        ? node.observability.tags.filter(Boolean).map((tag) => String(tag))
        : [],
    },
  };
}

export function buildDefaultMetadata(metadata = {}) {
  return {
    source: metadata.source || 'unknown',
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: metadata.updatedAt || new Date().toISOString(),
    labels: Array.isArray(metadata.labels) ? metadata.labels : [],
    extensions: metadata.extensions && typeof metadata.extensions === 'object'
      ? metadata.extensions
      : {},
  };
}
