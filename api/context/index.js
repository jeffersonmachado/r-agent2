'use strict';

const { getContext, patchContext } = require('./contextStore');
const { mergeEntities } = require('../entities/entityMerger');
const { ensureRequiredTags, normalizeTag, splitTags, diffTags } = require('../support/tagRules');

const FUNNEL_OWNERS = new Set(['classifier', 'orchestrator', 'message.processor']);

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeActor(meta = {}) {
  return {
    actor_type: meta.actor_type || 'system',
    actor_id: meta.actor_id || 'context_api',
    module: String(meta.module || '').trim().toLowerCase() || 'unknown',
    reason: meta.reason ? String(meta.reason) : null,
  };
}

function canMutateFunnel(meta = {}) {
  const actor = normalizeActor(meta);
  if (meta.override === true) return true;
  if (FUNNEL_OWNERS.has(actor.module)) return true;
  return false;
}

async function auditContextChange({ tenantId, sessionId, action, payload, meta = {} }) {
  try {
    const { appendEventV1 } = require('../services/eventLedgerService');
    const actor = normalizeActor(meta);
    await appendEventV1({
      tenantId,
      type: 'ContextUpdated',
      source: 'context.api',
      correlationId: meta.trace_id || `${tenantId}:${sessionId}`,
      subject: { type: 'channel_session', id: sessionId },
      actor: { type: actor.actor_type, id: actor.actor_id },
      idempotencyKey: `context_api:${action}:${tenantId}:${sessionId}:${Date.now()}`,
      payload: {
        action,
        reason: actor.reason,
        module: actor.module,
        ...ensureObject(payload),
      },
    });
  } catch (_) {}
}

async function getNormalizedContext(tenant_id, session_id) {
  return getContext(tenant_id, session_id);
}

async function applyTags(tenant_id, session_id, patch = { add: [], remove: [] }, meta = {}) {
  const current = await getContext(tenant_id, session_id);
  const add = splitTags(patch.add || []).map(normalizeTag).filter(Boolean);
  const remove = new Set(splitTags(patch.remove || []).map(normalizeTag).filter(Boolean));

  let nextTags = (Array.isArray(current.tags) ? current.tags : []).filter((tag) => !remove.has(normalizeTag(tag)));
  nextTags = Array.from(new Set([...nextTags, ...add]));

  const attemptsToModifyCore = [...add, ...remove].some((tag) => tag.startsWith('intent:') || tag.startsWith('severity:'));
  if (attemptsToModifyCore && !canMutateFunnel(meta)) {
    const err = new Error('funnel_tag_mutation_not_allowed');
    err.code = 'funnel_tag_mutation_not_allowed';
    throw err;
  }

  const ensured = ensureRequiredTags(nextTags, {
    intent: `intent:${current?.funnel_state?.intent || 'support'}`,
    severity: `severity:${current?.funnel_state?.severity || 'medium'}`,
  });

  const delta = diffTags(current.tags || [], ensured.tags || []);
  const updated = await patchContext(tenant_id, session_id, {
    tags: ensured.tags,
    trace_id: meta.trace_id || current.trace_id,
  });

  await auditContextChange({
    tenantId: tenant_id,
    sessionId: session_id,
    action: 'apply_tags',
    payload: { tags_added: delta.added, tags_removed: delta.removed, warnings: ensured.warnings || [] },
    meta,
  });

  return updated;
}

async function applyEntities(tenant_id, session_id, entitiesPatch = {}, metaPatch = {}, meta = {}) {
  const current = await getContext(tenant_id, session_id);
  const merged = mergeEntities(
    current.entities || {},
    current.entity_meta || {},
    ensureObject(entitiesPatch),
    ensureObject(metaPatch),
  );

  const updated = await patchContext(tenant_id, session_id, {
    entities: merged.entities,
    entity_meta: merged.meta,
    trace_id: meta.trace_id || current.trace_id,
  });

  await auditContextChange({
    tenantId: tenant_id,
    sessionId: session_id,
    action: 'apply_entities',
    payload: { entity_keys: Object.keys(ensureObject(entitiesPatch)) },
    meta,
  });

  return updated;
}

async function setFunnelState(tenant_id, session_id, funnelPatch = {}, meta = {}) {
  const current = await getContext(tenant_id, session_id);
  const patch = ensureObject(funnelPatch);
  const mutatesCore = Object.prototype.hasOwnProperty.call(patch, 'intent')
    || Object.prototype.hasOwnProperty.call(patch, 'severity')
    || Object.prototype.hasOwnProperty.call(patch, 'stage');

  if (mutatesCore && !canMutateFunnel(meta)) {
    const err = new Error('funnel_state_mutation_not_allowed');
    err.code = 'funnel_state_mutation_not_allowed';
    throw err;
  }

  const nextFunnel = {
    ...(current.funnel_state || {}),
    ...patch,
  };

  const updated = await patchContext(tenant_id, session_id, {
    funnel_state: nextFunnel,
    trace_id: meta.trace_id || current.trace_id,
  });

  await auditContextChange({
    tenantId: tenant_id,
    sessionId: session_id,
    action: 'set_funnel_state',
    payload: { funnel_patch: patch },
    meta,
  });

  return updated;
}

module.exports = {
  getNormalizedContext,
  applyTags,
  applyEntities,
  setFunnelState,
};
