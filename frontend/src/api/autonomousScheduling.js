import { fetchJson } from './client';

export function getAutonomousSchedulingPolicy() {
  return fetchJson('/api/autonomous-scheduling/policy', { method: 'GET' });
}

export function updateAutonomousSchedulingPolicy(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/policy', {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function listAutonomousWaitingList(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/waiting-list${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function createAutonomousWaitingListEntry(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/waiting-list', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateAutonomousWaitingListEntry(id, payload = {}) {
  return fetchJson(`/api/autonomous-scheduling/waiting-list/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function deactivateAutonomousWaitingListEntry(id) {
  return fetchJson(`/api/autonomous-scheduling/waiting-list/${encodeURIComponent(String(id))}/deactivate`, {
    method: 'POST',
  });
}

export function runAutonomousGapDetection(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/detect-gaps/run', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listAutonomousCampaigns(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/campaigns${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function getAutonomousSchedulingMetrics() {
  return fetchJson('/api/autonomous-scheduling/metrics', { method: 'GET' });
}

export function getAutonomousSchedulingRuntime() {
  return fetchJson('/api/autonomous-scheduling/runtime', { method: 'GET' });
}

export function updateAutonomousSchedulingRuntime(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/runtime', {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function listAutonomousTemplates() {
  return fetchJson('/api/autonomous-scheduling/templates', { method: 'GET' });
}

export function getAutonomousAggregatedMetrics(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/metrics/aggregated${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function getAutonomousPredictiveInsights(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/insights${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function generateOperationalMetricSnapshot(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/metrics/snapshots/run', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listOperationalMetricSnapshots(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/metrics/snapshots${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function listAutonomousRecommendations(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/autonomous-scheduling/recommendations${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function previewAutonomousCoreRun(payload = {}) {
  return fetchJson('/api/autonomous-scheduling/preview-run', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function detectRevenueOpportunities() {
  return fetchJson('/api/autonomous-scheduling/revenue/detect', { method: 'POST' });
}

export function listRevenueOpportunities() {
  return fetchJson('/api/autonomous-scheduling/revenue/opportunities', { method: 'GET' });
}

export function listAutonomousCampaignCandidates(campaignId) {
  return fetchJson(`/api/autonomous-scheduling/campaigns/${encodeURIComponent(String(campaignId))}/candidates`, { method: 'GET' });
}

export function acceptAutonomousCampaignCandidate(campaignId, candidateId) {
  return fetchJson(`/api/autonomous-scheduling/campaigns/${encodeURIComponent(String(campaignId))}/candidates/${encodeURIComponent(String(candidateId))}/accept`, {
    method: 'POST',
  });
}

export function rejectAutonomousCampaignCandidate(campaignId, candidateId) {
  return fetchJson(`/api/autonomous-scheduling/campaigns/${encodeURIComponent(String(campaignId))}/candidates/${encodeURIComponent(String(candidateId))}/reject`, {
    method: 'POST',
  });
}

export function createKioskSession(payload = {}) {
  return fetchJson('/api/kiosk/sessions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listKioskSessions(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return fetchJson(`/api/kiosk/sessions${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function closeKioskSession(sessionId, payload = {}) {
  return fetchJson(`/api/kiosk/sessions/${encodeURIComponent(String(sessionId))}/close`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function kioskCheckin(payload = {}) {
  return fetchJson('/api/kiosk/checkin', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function kioskAvailabilityLookup(payload = {}) {
  return fetchJson('/api/kiosk/availability', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
