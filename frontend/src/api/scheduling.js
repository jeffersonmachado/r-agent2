import { fetchJson } from './client';

export function listSchedules(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    params.set(k, String(v));
  });
  const query = params.toString();
  return fetchJson(`/api/schedules${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function createSchedule(payload) {
  return fetchJson('/api/schedules', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getScheduleAvailability(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    query.set(k, String(v));
  });
  return fetchJson(`/api/schedules/availability?${query.toString()}`, {
    method: 'GET',
  });
}

export function confirmSchedule(id, payload = {}) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function declineSchedule(id, payload = {}) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function rescheduleSchedule(id, payload = {}) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function cancelSchedule(id, payload = {}) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function markScheduleInProgress(id) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/in-progress`, { method: 'POST' });
}

export function markScheduleDone(id) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/done`, { method: 'POST' });
}

export function markScheduleNoShow(id) {
  return fetchJson(`/api/schedules/${encodeURIComponent(id)}/no-show`, { method: 'POST' });
}

