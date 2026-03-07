'use strict';

const { conversationSessionStore } = require('./conversationSessionStore');

function buildWhatsAppIvrStateKey({ tenantId, sessionId }) {
  return `whatsapp_ivr_state:${String(tenantId)}:${String(sessionId)}`;
}

function normalizeState(input = {}, { tenantId, sessionId, timeoutSeconds = 600 } = {}) {
  return {
    status: ['idle', 'awaiting_choice', 'routed'].includes(input.status) ? input.status : 'idle',
    tenantId: String(input.tenantId || tenantId || ''),
    sessionId: String(input.sessionId || sessionId || ''),
    conversationId: input.conversationId ? String(input.conversationId) : null,
    lastMenuSentAt: input.lastMenuSentAt || null,
    expiresAt: input.expiresAt || (timeoutSeconds > 0 ? new Date(Date.now() + (timeoutSeconds * 1000)).toISOString() : null),
    attempts: Number.isFinite(Number(input.attempts)) ? Number(input.attempts) : 0,
    selectedDepartmentId: input.selectedDepartmentId ? String(input.selectedDepartmentId) : null,
    selectedVia: input.selectedVia ? String(input.selectedVia) : null,
    lastAction: input.lastAction ? String(input.lastAction) : null,
  };
}

async function getState({ tenantId, sessionId }) {
  const key = buildWhatsAppIvrStateKey({ tenantId, sessionId });
  return conversationSessionStore.get(key);
}

async function setState({ tenantId, sessionId, state, timeoutSeconds = 600 }) {
  const key = buildWhatsAppIvrStateKey({ tenantId, sessionId });
  const normalized = normalizeState(state, { tenantId, sessionId, timeoutSeconds });
  await conversationSessionStore.set(key, normalized, timeoutSeconds);
  return normalized;
}

async function updateState({ tenantId, sessionId, patch, timeoutSeconds = 600 }) {
  const current = await getState({ tenantId, sessionId });
  return setState({
    tenantId,
    sessionId,
    timeoutSeconds,
    state: {
      ...(current || {}),
      ...(patch || {}),
    },
  });
}

async function resetState({ tenantId, sessionId }) {
  const key = buildWhatsAppIvrStateKey({ tenantId, sessionId });
  await conversationSessionStore.delete(key);
  return true;
}

module.exports = {
  buildWhatsAppIvrStateKey,
  getState,
  setState,
  updateState,
  resetState,
};
