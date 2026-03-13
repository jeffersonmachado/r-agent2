export const DEFAULT_CANONICAL_VERSION = 1;

export const DEFAULT_RETRY_POLICY = {
  enabled: false,
  maxAttempts: 1,
  strategy: 'none',
};

export const DEFAULT_TIMEOUT_POLICY = {
  enabled: false,
  timeoutMs: null,
};

export const DEFAULT_FALLBACK_POLICY = {
  enabled: false,
  mode: 'none',
  target: null,
};

export const DEFAULT_HUMAN_HANDOFF_POLICY = {
  enabled: false,
  queue: null,
};

export const DEFAULT_AI_POLICY = {
  enabled: false,
  mode: null,
  provider: null,
  task: null,
};

export const DEFAULT_OBSERVABILITY = {
  tags: [],
  metrics: [],
  traceKey: null,
  layout: null,
};

export const DEFAULT_PROCESS_POLICIES = {
  retry: { ...DEFAULT_RETRY_POLICY },
  timeout: { ...DEFAULT_TIMEOUT_POLICY },
};

export const DEFAULT_AI_CONFIG = {
  provider: null,
  model: null,
};

export const DEFAULT_OPERATIONAL_CONFIG = {
  executionMode: 'deterministic',
  allowPartialValidation: true,
};

export function cloneDefault(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createDefaultNodePolicies() {
  return {
    retryPolicy: cloneDefault(DEFAULT_RETRY_POLICY),
    timeoutPolicy: cloneDefault(DEFAULT_TIMEOUT_POLICY),
    fallbackPolicy: cloneDefault(DEFAULT_FALLBACK_POLICY),
    humanHandoffPolicy: cloneDefault(DEFAULT_HUMAN_HANDOFF_POLICY),
    aiPolicy: cloneDefault(DEFAULT_AI_POLICY),
    observability: cloneDefault(DEFAULT_OBSERVABILITY),
  };
}
