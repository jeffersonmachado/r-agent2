import { fetchJson } from './client';

export function listAutomations() {
  return fetchJson('/automations', { method: 'GET' });
}

export function upsertAutomation(payload) {
  return fetchJson('/automations', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function publishAutomation(id) {
  return fetchJson(`/automations/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export function runAutomation(id, runContext = null) {
  const payload = runContext && typeof runContext === 'object'
    ? {
        session_id: runContext.session_id || runContext.sessionId || null,
        text: runContext.text || runContext.message || runContext.user_input || null,
      }
    : null;

  return fetchJson(`/automations/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}
