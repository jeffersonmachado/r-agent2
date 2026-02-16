import { fetchJson } from './client';

export function listPauseReasons() {
  return fetchJson('/api/cc/pause-reasons', { method: 'GET' });
}

export function upsertPauseReason(payload) {
  return fetchJson('/api/cc/pause-reasons', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listContactReasons() {
  return fetchJson('/api/cc/contact-reasons', { method: 'GET' });
}

export function upsertContactReason(payload) {
  return fetchJson('/api/cc/contact-reasons', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listCampaigns() {
  return fetchJson('/api/cc/campaigns', { method: 'GET' });
}

export function upsertCampaign(payload) {
  return fetchJson('/api/cc/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listCampaignList(campaignId) {
  const qs = `?campaignId=${encodeURIComponent(String(campaignId || ''))}`;
  return fetchJson(`/api/cc/campaigns/list${qs}`, { method: 'GET' });
}

export function addCampaignListItems({ campaignId, items }) {
  return fetchJson('/api/cc/campaigns/list', {
    method: 'POST',
    body: JSON.stringify({ campaignId, items: Array.isArray(items) ? items : [] }),
  });
}

export function listScheduledCallbacks() {
  return fetchJson('/api/cc/scheduled-callbacks', { method: 'GET' });
}

export function upsertScheduledCallback(payload) {
  return fetchJson('/api/cc/scheduled-callbacks', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listClick2CallRequests(limit = 100) {
  const qs = `?limit=${encodeURIComponent(String(limit || 100))}`;
  return fetchJson(`/api/cc/click2call${qs}`, { method: 'GET' });
}

export function createClick2CallRequest(payload) {
  return fetchJson('/api/cc/click2call', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

