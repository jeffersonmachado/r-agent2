import { fetchJson } from './client';

function buildCalendarQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export function getMyCalendar(params = {}) {
  return fetchJson(`/api/calendar/me${buildCalendarQuery(params)}`, { method: 'GET' });
}

export function getResourceCalendar(resourceId, params = {}) {
  return fetchJson(`/api/calendar/resource/${encodeURIComponent(resourceId)}${buildCalendarQuery(params)}`, { method: 'GET' });
}

export function createResourceBlock(resourceId, payload = {}) {
  return fetchJson(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function deleteResourceBlock(resourceId, blockId) {
  return fetchJson(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks/${encodeURIComponent(blockId)}`, {
    method: 'DELETE',
  });
}
