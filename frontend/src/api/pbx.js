import { fetchJson } from './client';

export function listExtensions() {
  return fetchJson('/api/pbx/extensions', { method: 'GET' });
}

export function upsertExtension(payload) {
  return fetchJson('/api/pbx/extensions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listTrunks() {
  return fetchJson('/api/pbx/trunks', { method: 'GET' });
}

export function upsertTrunk(payload) {
  return fetchJson('/api/pbx/trunks', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listRoutes(direction = null) {
  const qs = direction ? `?direction=${encodeURIComponent(direction)}` : '';
  return fetchJson(`/api/pbx/routes${qs}`, { method: 'GET' });
}

export function upsertRoute(payload) {
  return fetchJson('/api/pbx/routes', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listQueues() {
  return fetchJson('/api/pbx/queues', { method: 'GET' });
}

export function upsertQueue(payload) {
  return fetchJson('/api/pbx/queues', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function dialplanPreview() {
  return fetchJson('/api/pbx/dialplan/preview', { method: 'POST', body: JSON.stringify({}) });
}

export function dialplanApply() {
  return fetchJson('/api/pbx/dialplan/apply', { method: 'POST', body: JSON.stringify({}) });
}

export function pbxReload() {
  return fetchJson('/api/pbx/reload', { method: 'POST', body: JSON.stringify({}) });
}

export function listQueueMembers(queueId) {
  const qs = `?queueId=${encodeURIComponent(String(queueId || ''))}`;
  return fetchJson(`/api/pbx/queue-members${qs}`, { method: 'GET' });
}

export function upsertQueueMember(payload) {
  return fetchJson('/api/pbx/queue-members', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function deleteQueueMember(id) {
  const qs = `?id=${encodeURIComponent(String(id || ''))}`;
  return fetchJson(`/api/pbx/queue-members${qs}`, { method: 'DELETE' });
}

export function listDids() {
  return fetchJson('/api/pbx/dids', { method: 'GET' });
}

export function upsertDid(payload) {
  return fetchJson('/api/pbx/dids', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listCallRules(type = null) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return fetchJson(`/api/pbx/call-rules${qs}`, { method: 'GET' });
}

export function upsertCallRule(payload) {
  return fetchJson('/api/pbx/call-rules', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listAudioAssets(kind = null) {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return fetchJson(`/api/pbx/audio-assets${qs}`, { method: 'GET' });
}

export function uploadAudioAsset({ kind, file }) {
  const fd = new FormData();
  if (kind) fd.append('kind', String(kind));
  if (file) fd.append('file', file);
  return fetchJson('/api/pbx/audio-assets/upload', {
    method: 'POST',
    body: fd,
  });
}

export function listRecordings(limit = 200) {
  const qs = `?limit=${encodeURIComponent(String(limit))}`;
  return fetchJson(`/api/pbx/recordings${qs}`, { method: 'GET' });
}

export function scanRecordings() {
  return fetchJson('/api/pbx/recordings/scan', { method: 'POST', body: JSON.stringify({}) });
}

export function listCdr(filters = {}) {
  const sp = new URLSearchParams();
  if (filters.limit != null) sp.set('limit', String(filters.limit));
  if (filters.from) sp.set('from', String(filters.from));
  if (filters.to) sp.set('to', String(filters.to));
  if (filters.src) sp.set('src', String(filters.src));
  if (filters.dst) sp.set('dst', String(filters.dst));
  if (filters.uniqueid) sp.set('uniqueid', String(filters.uniqueid));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return fetchJson(`/api/pbx/cdr${qs}`, { method: 'GET' });
}

