import { fetchJson } from './client';

export function listAccessDevices() {
  return fetchJson('/api/access-control/devices');
}

export function createAccessDevice(payload) {
  return fetchJson('/api/access-control/devices', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccessDevice(id, payload) {
  return fetchJson(`/api/access-control/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAccessCredentials() {
  return fetchJson('/api/access-control/credentials');
}

export function createAccessCredential(payload) {
  return fetchJson('/api/access-control/credentials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccessCredential(id, payload) {
  return fetchJson(`/api/access-control/credentials/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAccessPolicies() {
  return fetchJson('/api/access-control/policies');
}

export function createAccessPolicy(payload) {
  return fetchJson('/api/access-control/policies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccessPolicy(id, payload) {
  return fetchJson(`/api/access-control/policies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAccessEvents(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return fetchJson(`/api/access-control/events${suffix}`);
}

export function listAccessDecisions(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return fetchJson(`/api/access-control/decisions${suffix}`);
}

export function getAccessDecisionStatus(id) {
  return fetchJson(`/api/access-control/decisions/${encodeURIComponent(id)}/status`);
}

export function getAccessControlHealth(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return fetchJson(`/api/access-control/health${suffix}`);
}

export function createVisitorAccessQr(payload) {
  return fetchJson('/api/access-control/visitors/qrcode', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
