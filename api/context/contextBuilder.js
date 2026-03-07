'use strict';

const { createNormalizedContext } = require('../contracts/normalizedContext');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildNormalizedContext({
  event,
  session,
  funnel_state,
  tags,
  entities,
  entity_meta,
} = {}) {
  const safeEvent = ensureObject(event);
  const safeSession = ensureObject(session);
  const metadata = ensureObject(safeSession.metadata);

  const finalFunnel = funnel_state
    || safeSession.funnel_state
    || metadata.funnel_state
    || { stage: 'awareness', intent: 'unknown', severity: 'medium', next_action: 'ask' };

  const finalTags = Array.isArray(tags)
    ? tags
    : (Array.isArray(safeSession.tags) ? safeSession.tags : (Array.isArray(metadata.tags) ? metadata.tags : []));

  const finalEntities = entities
    || safeSession.entities
    || metadata.entities
    || {};

  const finalEntityMeta = entity_meta
    || safeSession.entity_meta
    || metadata.entity_meta
    || {};

  return createNormalizedContext({
    tenant_id: safeEvent.tenant_id || safeSession.tenantId || safeSession.tenant_id || 'unknown',
    lead_id: safeEvent.lead_id || metadata.phoneNumber || null,
    session_id: safeEvent.session_id || safeSession.sessionId || safeSession.session_id || 'unknown',
    channel: safeEvent.channel || metadata.channel || 'unknown',
    media: safeEvent.media || 'unknown',
    trace_id: safeEvent.trace_id || safeSession.trace_id || metadata.trace_id || 'trace_unknown',
    timestamp: safeEvent.timestamp || metadata.updatedAt || new Date().toISOString(),
    funnel_state: finalFunnel,
    tags: finalTags,
    entities: finalEntities,
    entity_meta: finalEntityMeta,
    last_event: safeEvent.event_type ? safeEvent : (safeSession.last_event || metadata.last_event || undefined),
  });
}

module.exports = {
  buildNormalizedContext,
};
