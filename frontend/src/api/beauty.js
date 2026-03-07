import { fetchJson } from './client';

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getBeautyDashboard() {
  return fetchJson('/api/beauty/dashboard', { method: 'GET' });
}

export function listBeautyProfessionals(filters = {}) {
  return fetchJson(`/api/beauty/professionals${toQuery(filters)}`, { method: 'GET' });
}

export function createBeautyProfessional(payload = {}) {
  return fetchJson('/api/beauty/professionals', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateBeautyProfessional(id, payload = {}) {
  return fetchJson(`/api/beauty/professionals/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function listBeautyServices(filters = {}) {
  return fetchJson(`/api/beauty/services${toQuery(filters)}`, { method: 'GET' });
}

export function createBeautyService(payload = {}) {
  return fetchJson('/api/beauty/services', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateBeautyService(id, payload = {}) {
  return fetchJson(`/api/beauty/services/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function listBeautyAssignments(filters = {}) {
  return fetchJson(`/api/beauty/assignments${toQuery(filters)}`, { method: 'GET' });
}

export function saveBeautyAssignment(payload = {}) {
  return fetchJson('/api/beauty/assignments', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listBeautyCompositions(serviceId) {
  return fetchJson(`/api/beauty/compositions/${encodeURIComponent(String(serviceId))}`, { method: 'GET' });
}

export function updateBeautyCompositions(serviceId, items = []) {
  return fetchJson(`/api/beauty/compositions/${encodeURIComponent(String(serviceId))}`, {
    method: 'PUT',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] }),
  });
}

export function updateBeautyLoyalty(contactId, payload = {}) {
  return fetchJson(`/api/beauty/loyalty/${encodeURIComponent(String(contactId))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function updateBeautyPreference(contactId, payload = {}) {
  return fetchJson(`/api/beauty/preferences/${encodeURIComponent(String(contactId))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function resolveBeautyBundle(payload = {}) {
  return fetchJson('/api/beauty/resolve-bundle', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createBeautyBooking(payload = {}) {
  return fetchJson('/api/beauty/bookings', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
