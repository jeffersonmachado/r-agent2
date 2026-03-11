export const RAGENT2_BPMN_EXTENSION_NAMESPACE = 'http://r-agent2.io/bpmn/extensions';
export const RAGENT2_BPMN_EXTENSION_PREFIX = 'ragent2';

export const BPMN_EXTENSION_TYPES = Object.freeze({
  AI_TASK: 'ai_task',
  API: 'api',
  HANDOFF: 'handoff',
  SCHEDULE_ROUTER: 'schedule_router',
  FALLBACK: 'fallback',
});

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

export function buildNodeExtensionPayload(nodeType, config = {}) {
  const normalizedType = String(nodeType || '').trim();

  switch (normalizedType) {
    case BPMN_EXTENSION_TYPES.AI_TASK:
      return {
        type: BPMN_EXTENSION_TYPES.AI_TASK,
        data: pick(config, ['provider', 'model', 'prompt', 'params', 'guardrails', 'task', 'allowedOutputs', 'fallback']),
      };

    case BPMN_EXTENSION_TYPES.API:
      return {
        type: BPMN_EXTENSION_TYPES.API,
        data: pick(config, ['url', 'method', 'headers', 'auth', 'timeout', 'query', 'body']),
      };

    case BPMN_EXTENSION_TYPES.HANDOFF:
      return {
        type: BPMN_EXTENSION_TYPES.HANDOFF,
        data: pick(config, ['queue', 'agent', 'sla', 'resumePolicy']),
      };

    case BPMN_EXTENSION_TYPES.SCHEDULE_ROUTER:
      return {
        type: BPMN_EXTENSION_TYPES.SCHEDULE_ROUTER,
        data: pick(config, ['timezone', 'schedules', 'defaultNext', 'policy']),
      };

    case BPMN_EXTENSION_TYPES.FALLBACK:
      return {
        type: BPMN_EXTENSION_TYPES.FALLBACK,
        data: pick(config, ['maxAttempts', 'confidenceThreshold', 'escalationMode', 'allowReturnToBot', 'safeReturnNode', 'queue', 'policy']),
      };

    default:
      return null;
  }
}

export function shouldAttachExtension(nodeType) {
  return !!buildNodeExtensionPayload(nodeType, {});
}
