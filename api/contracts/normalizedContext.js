'use strict';

const CHANNELS = ['whatsapp', 'web', 'app', 'api', 'voice', 'messenger', 'instagram', 'unknown'];
const MEDIA_TYPES = ['text', 'audio', 'image', 'file', 'unknown'];
const FUNNEL_STAGES = ['awareness', 'interest', 'consideration', 'decision', 'post_sale', 'support', 'churn_risk'];
const FUNNEL_INTENTS = ['sales', 'support', 'billing', 'complaint', 'cancel', 'info', 'unknown'];
const FUNNEL_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const FUNNEL_NEXT_ACTIONS = ['ask', 'educate', 'offer', 'handoff', 'followup', 'close'];
const ENTITY_SOURCES = ['user', 'regex', 'llm', 'enrichment', 'system'];

function ensureString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
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
    const d = new Date(Number(value));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
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

function normalizeEntityValue(input = {}, fallbackSource = 'system') {
  const value = input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : input;
  const source = ensureEnum(input && input.source, ENTITY_SOURCES, fallbackSource);
  const confidenceRaw = Number(input && input.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.5;
  return {
    value,
    source,
    confidence,
    updated_at: ensureIso(input && input.updated_at),
  };
}

function normalizeEntities(input = {}) {
  const base = ensureObject(input);
  const out = {};
  for (const key of Object.keys(base)) {
    const raw = base[key];
    if (Array.isArray(raw)) {
      const normalizedList = raw.map((item) => normalizeEntityValue(item)).filter((item) => item && item.value !== undefined);
      if (normalizedList.length > 0) out[key] = normalizedList;
      continue;
    }
    const normalized = normalizeEntityValue(raw);
    if (normalized.value !== undefined) out[key] = normalized;
  }
  return out;
}

function normalizeEntityMeta(input = {}) {
  const base = ensureObject(input);
  const out = {};
  for (const key of Object.keys(base)) {
    const item = ensureObject(base[key]);
    out[key] = {
      source: ensureEnum(item.source, ENTITY_SOURCES, 'system'),
      confidence: Number.isFinite(Number(item.confidence))
        ? Math.max(0, Math.min(1, Number(item.confidence)))
        : 0.5,
      updated_at: ensureIso(item.updated_at),
    };
  }
  return out;
}

function normalizeFunnelState(input = {}) {
  const base = ensureObject(input);
  const score = Number(base.score);
  return {
    stage: ensureEnum(base.stage, FUNNEL_STAGES, 'awareness'),
    intent: ensureEnum(base.intent, FUNNEL_INTENTS, 'unknown'),
    severity: ensureEnum(base.severity, FUNNEL_SEVERITIES, 'medium'),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : undefined,
    next_action: ensureEnum(base.next_action, FUNNEL_NEXT_ACTIONS, 'ask'),
  };
}

/**
 * @typedef {Object} EntityValue
 * @property {string|number|boolean|object|null} value
 * @property {'user'|'regex'|'llm'|'enrichment'|'system'} source
 * @property {number} confidence
 * @property {string} updated_at
 */

/**
 * @typedef {Object} NormalizedContext
 * @property {string} tenant_id
 * @property {string|null} [lead_id]
 * @property {string} session_id
 * @property {'whatsapp'|'web'|'app'|'api'|'voice'|'messenger'|'instagram'|'unknown'} channel
 * @property {'text'|'audio'|'image'|'file'|'unknown'} media
 * @property {string} trace_id
 * @property {string} timestamp
 * @property {{ stage: 'awareness'|'interest'|'consideration'|'decision'|'post_sale'|'support'|'churn_risk', intent: 'sales'|'support'|'billing'|'complaint'|'cancel'|'info'|'unknown', severity: 'low'|'medium'|'high'|'critical', score?: number, next_action?: 'ask'|'educate'|'offer'|'handoff'|'followup'|'close' }} funnel_state
 * @property {string[]} tags
 * @property {Record<string, EntityValue|EntityValue[]>} entities
 * @property {Record<string, {source: string, confidence: number, updated_at: string}>} [entity_meta]
 * @property {Record<string, any>} [last_event]
 * @property {{warnings?: string[]}} [debug]
 */

function createNormalizedContext(input = {}) {
  const normalized = {
    tenant_id: ensureString(input.tenant_id || input.tenantId, 'unknown'),
    lead_id: ensureString(input.lead_id || input.leadId, '') || undefined,
    session_id: ensureString(input.session_id || input.sessionId, 'unknown'),
    channel: ensureEnum(input.channel, CHANNELS, 'unknown'),
    media: ensureEnum(input.media, MEDIA_TYPES, 'unknown'),
    trace_id: ensureString(input.trace_id || input.traceId, 'trace_unknown'),
    timestamp: ensureIso(input.timestamp),
    funnel_state: normalizeFunnelState(input.funnel_state),
    tags: ensureTags(input.tags),
    entities: normalizeEntities(input.entities),
    entity_meta: normalizeEntityMeta(input.entity_meta),
    last_event: input.last_event && typeof input.last_event === 'object' ? input.last_event : undefined,
    debug: input.debug && typeof input.debug === 'object' ? input.debug : undefined,
  };

  if (!Object.keys(normalized.entity_meta || {}).length) delete normalized.entity_meta;
  if (!normalized.lead_id) delete normalized.lead_id;
  if (!normalized.last_event) delete normalized.last_event;
  if (!normalized.debug) delete normalized.debug;
  if (normalized.funnel_state.score === undefined) delete normalized.funnel_state.score;
  if (!normalized.funnel_state.next_action) delete normalized.funnel_state.next_action;

  return normalized;
}

function validateNormalizedContext(ctx) {
  const errors = [];
  if (!ctx || typeof ctx !== 'object') {
    return { valid: false, errors: ['context must be an object'] };
  }
  if (!ensureString(ctx.tenant_id)) errors.push('tenant_id required');
  if (!ensureString(ctx.session_id)) errors.push('session_id required');
  if (!CHANNELS.includes(String(ctx.channel || '').toLowerCase())) errors.push('invalid channel');
  if (!MEDIA_TYPES.includes(String(ctx.media || '').toLowerCase())) errors.push('invalid media');
  if (!ensureString(ctx.trace_id)) errors.push('trace_id required');
  if (Number.isNaN(new Date(ctx.timestamp).getTime())) errors.push('timestamp invalid');

  const funnel = ensureObject(ctx.funnel_state);
  if (!FUNNEL_STAGES.includes(String(funnel.stage || '').toLowerCase())) errors.push('invalid funnel_state.stage');
  if (!FUNNEL_INTENTS.includes(String(funnel.intent || '').toLowerCase())) errors.push('invalid funnel_state.intent');
  if (!FUNNEL_SEVERITIES.includes(String(funnel.severity || '').toLowerCase())) errors.push('invalid funnel_state.severity');

  return { valid: errors.length === 0, errors };
}

module.exports = {
  CHANNELS,
  MEDIA_TYPES,
  FUNNEL_STAGES,
  FUNNEL_INTENTS,
  FUNNEL_SEVERITIES,
  FUNNEL_NEXT_ACTIONS,
  ENTITY_SOURCES,
  createNormalizedContext,
  validateNormalizedContext,
  normalizeFunnelState,
  normalizeEntityValue,
};
