'use strict';

const {
  conversationSessionStore,
  buildConversationSessionKey,
} = require('../services/conversationSessionStore');
const { buildNormalizedContext } = require('./contextBuilder');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeUniqueTags(base = [], incoming = []) {
  return Array.from(new Set([
    ...(Array.isArray(base) ? base : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ].filter(Boolean)));
}

function applyPatchToSession(session, patch = {}) {
  const current = ensureObject(session);
  const metadata = ensureObject(current.metadata);

  const next = {
    ...current,
    metadata: {
      ...metadata,
    },
  };

  if (patch.funnel_state && typeof patch.funnel_state === 'object') {
    next.funnel_state = patch.funnel_state;
    next.metadata.funnel_state = patch.funnel_state;
  }

  if (Array.isArray(patch.tags)) {
    const mergedTags = mergeUniqueTags(current.tags || metadata.tags || [], patch.tags);
    next.tags = mergedTags;
    next.metadata.tags = mergedTags;
  }

  if (patch.entities && typeof patch.entities === 'object') {
    next.entities = {
      ...(current.entities && typeof current.entities === 'object' ? current.entities : {}),
      ...patch.entities,
    };
    next.metadata.entities = next.entities;
  }

  if (patch.entity_meta && typeof patch.entity_meta === 'object') {
    next.entity_meta = {
      ...(current.entity_meta && typeof current.entity_meta === 'object' ? current.entity_meta : {}),
      ...patch.entity_meta,
    };
    next.metadata.entity_meta = next.entity_meta;
  }

  if (patch.trace_id) {
    next.trace_id = patch.trace_id;
    next.metadata.trace_id = patch.trace_id;
  }

  if (patch.last_event && typeof patch.last_event === 'object') {
    next.last_event = patch.last_event;
    next.metadata.last_event = patch.last_event;
  }

  return next;
}

async function getContext(tenant_id, session_id) {
  const key = buildConversationSessionKey({ tenantId: tenant_id, sessionId: session_id });
  const session = await conversationSessionStore.get(key);
  return buildNormalizedContext({
    event: {
      tenant_id,
      session_id,
      trace_id: (session && (session.trace_id || session?.metadata?.trace_id)) || `trace_${Date.now()}`,
      timestamp: new Date().toISOString(),
      channel: session?.metadata?.channel || 'unknown',
      media: 'unknown',
    },
    session,
  });
}

async function patchContext(tenant_id, session_id, patch = {}) {
  const key = buildConversationSessionKey({ tenantId: tenant_id, sessionId: session_id });
  const current = await conversationSessionStore.get(key);
  const nextSession = applyPatchToSession(current, patch);
  await conversationSessionStore.set(
    key,
    nextSession,
    Number(process.env.CONVERSATION_SESSION_TTL_SECONDS || 86400),
  );

  return buildNormalizedContext({
    event: {
      tenant_id,
      session_id,
      trace_id: patch.trace_id || nextSession.trace_id || `trace_${Date.now()}`,
      timestamp: new Date().toISOString(),
      channel: nextSession?.metadata?.channel || 'unknown',
      media: 'unknown',
    },
    session: nextSession,
  });
}

module.exports = {
  getContext,
  patchContext,
  applyPatchToSession,
};
