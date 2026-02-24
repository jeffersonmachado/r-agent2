'use strict';

const {
  createNormalizedInboundEvent,
  validateNormalizedInboundEvent,
} = require('../contracts/normalizedInboundEvent');

function safeString(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function parseTimestampFromLegacy(message) {
  const ts = message && message.timestamp ? Number(message.timestamp) : null;
  if (ts && Number.isFinite(ts)) {
    return new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }
  return new Date().toISOString();
}

function normalizeFromLegacyWhatsApp({ message, value, deps = {} }) {
  const channel = safeString(deps.channelType, 'whatsapp').toLowerCase();
  const from = safeString(message && message.from, 'unknown');
  const text = safeString(message && message.text && message.text.body, '');
  const explicitSessionId = safeString(deps.sessionId, '');
  const explicitTenantId = safeString(deps.tenantId, '');
  const sessionId = explicitSessionId || `${channel}_${from}`;
  const messageId = safeString(message && message.id, '');
  const correlationId = safeString(deps.conversationId, '') || messageId || sessionId;

  return createNormalizedInboundEvent({
    event_type: 'message',
    channel,
    media: 'text',
    direction: 'inbound',
    tenant_id: explicitTenantId || 'unknown',
    lead_id: from,
    session_id: sessionId,
    timestamp: parseTimestampFromLegacy(message),
    payload: {
      text,
      raw: message || null,
    },
    metadata: {
      message_id: messageId || null,
      conversation_id: deps.conversationId || null,
      value: value || null,
      channel_type: channel,
    },
    voice_metadata: {},
    trace_id: safeString(deps.traceId, '') || messageId || `${sessionId}-${Date.now()}`,
    correlation_id: correlationId,
  });
}

function normalizeInboundEvent(input = {}, options = {}) {
  if (input && typeof input === 'object' && input.event_type && input.channel && input.direction) {
    const candidate = createNormalizedInboundEvent(input);
    const valid = validateNormalizedInboundEvent(candidate);
    return {
      event: candidate,
      valid: valid.valid,
      errors: valid.errors,
      source: 'normalized',
    };
  }

  if (input && typeof input === 'object' && input.message && (input.value || options.deps)) {
    const event = normalizeFromLegacyWhatsApp({
      message: input.message,
      value: input.value || null,
      deps: options.deps || {},
    });
    const valid = validateNormalizedInboundEvent(event);
    return {
      event,
      valid: valid.valid,
      errors: valid.errors,
      source: 'legacy_whatsapp',
    };
  }

  const fallback = createNormalizedInboundEvent({
    event_type: 'unknown',
    channel: options.channel || 'unknown',
    media: 'unknown',
    direction: 'inbound',
    tenant_id: options.tenantId || 'unknown',
    session_id: options.sessionId || undefined,
    payload: input,
    metadata: options.metadata || {},
    voice_metadata: {},
    trace_id: options.traceId || undefined,
    correlation_id: options.correlationId || undefined,
  });
  const valid = validateNormalizedInboundEvent(fallback);
  return {
    event: fallback,
    valid: valid.valid,
    errors: valid.errors,
    source: 'fallback',
  };
}

module.exports = {
  normalizeInboundEvent,
};
