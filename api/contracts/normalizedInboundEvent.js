'use strict';

const crypto = require('crypto');

const EVENT_TYPES = ['message', 'handoff', 'system', 'conversion', 'unknown'];
const CHANNELS = ['whatsapp', 'web', 'app', 'api', 'voice', 'messenger', 'instagram', 'unknown'];
const MEDIA_TYPES = ['text', 'audio', 'image', 'file', 'unknown'];
const DIRECTIONS = ['inbound', 'outbound'];

/**
 * @typedef {Object} NormalizedInboundEvent
 * @property {'message'|'handoff'|'system'|'conversion'|'unknown'} event_type
 * @property {'whatsapp'|'web'|'app'|'api'|'voice'|'messenger'|'instagram'|'unknown'} channel
 * @property {'text'|'audio'|'image'|'file'|'unknown'} media
 * @property {'inbound'|'outbound'} direction
 * @property {string} tenant_id
 * @property {string|null} lead_id
 * @property {string} session_id
 * @property {string} timestamp
 * @property {any} payload
 * @property {Record<string, any>} metadata
 * @property {string[]} [tags]
 * @property {Record<string, any>} [entities]
 * @property {Record<string, any>} voice_metadata
 * @property {string} trace_id
 * @property {string} correlation_id
 */

function ensureString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function ensureEnum(value, allowed, fallback) {
  const normalized = ensureString(value, '').toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function ensureIso(value) {
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (Number.isFinite(Number(value))) {
    const n = Number(value);
    const millis = n > 1e12 ? n : n * 1000;
    const d = new Date(millis);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function randomId(prefix) {
  const rid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rid}`;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ensureTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => ensureString(tag, '').toLowerCase())
    .filter(Boolean);
}

function validateNormalizedInboundEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['event must be an object'] };
  }
  if (!EVENT_TYPES.includes(String(event.event_type || '').toLowerCase())) errors.push('invalid event_type');
  if (!CHANNELS.includes(String(event.channel || '').toLowerCase())) errors.push('invalid channel');
  if (!MEDIA_TYPES.includes(String(event.media || '').toLowerCase())) errors.push('invalid media');
  if (!DIRECTIONS.includes(String(event.direction || '').toLowerCase())) errors.push('invalid direction');
  if (!ensureString(event.tenant_id, '')) errors.push('tenant_id required');
  if (!ensureString(event.session_id, '')) errors.push('session_id required');
  if (!ensureString(event.trace_id, '')) errors.push('trace_id required');
  if (!ensureString(event.correlation_id, '')) errors.push('correlation_id required');

  const date = new Date(event.timestamp);
  if (Number.isNaN(date.getTime())) errors.push('timestamp invalid');

  return { valid: errors.length === 0, errors };
}

function createNormalizedInboundEvent(input = {}) {
  const fallbackTraceId = randomId('trace');
  const tenantId = ensureString(input.tenant_id || input.tenantId, 'unknown');
  const leadId = ensureString(input.lead_id || input.leadId || input.user_id || input.userId, '') || null;
  const sessionId = ensureString(input.session_id || input.sessionId, '')
    || ensureString(input.metadata && input.metadata.session_id, '')
    || randomId('session');
  const traceId = ensureString(input.trace_id || input.traceId, fallbackTraceId);
  const correlationId = ensureString(input.correlation_id || input.correlationId, traceId);

  /** @type {NormalizedInboundEvent} */
  const normalized = {
    event_type: ensureEnum(input.event_type || input.eventType, EVENT_TYPES, 'unknown'),
    channel: ensureEnum(input.channel, CHANNELS, 'unknown'),
    media: ensureEnum(input.media, MEDIA_TYPES, 'unknown'),
    direction: ensureEnum(input.direction, DIRECTIONS, 'inbound'),
    tenant_id: tenantId,
    lead_id: leadId,
    session_id: sessionId,
    timestamp: ensureIso(input.timestamp),
    payload: input.payload !== undefined ? input.payload : null,
    metadata: ensureObject(input.metadata),
    tags: ensureTags(input.tags),
    entities: ensureObject(input.entities),
    voice_metadata: ensureObject(input.voice_metadata),
    trace_id: traceId,
    correlation_id: correlationId,
  };

  const result = validateNormalizedInboundEvent(normalized);
  if (!result.valid) {
    normalized.event_type = EVENT_TYPES.includes(normalized.event_type) ? normalized.event_type : 'unknown';
    normalized.channel = CHANNELS.includes(normalized.channel) ? normalized.channel : 'unknown';
    normalized.media = MEDIA_TYPES.includes(normalized.media) ? normalized.media : 'unknown';
    normalized.direction = DIRECTIONS.includes(normalized.direction) ? normalized.direction : 'inbound';
    normalized.timestamp = ensureIso(normalized.timestamp);
    normalized.session_id = normalized.session_id || randomId('session');
    normalized.trace_id = normalized.trace_id || fallbackTraceId;
    normalized.correlation_id = normalized.correlation_id || normalized.trace_id;
    normalized.voice_metadata = ensureObject(normalized.voice_metadata);
    normalized.metadata = ensureObject(normalized.metadata);
    normalized.tags = ensureTags(normalized.tags);
    normalized.entities = ensureObject(normalized.entities);
  }

  return normalized;
}

module.exports = {
  EVENT_TYPES,
  CHANNELS,
  MEDIA_TYPES,
  DIRECTIONS,
  createNormalizedInboundEvent,
  validateNormalizedInboundEvent,
};
