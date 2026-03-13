import { fetchJson } from './client';

export function listMarketingForms() {
  return fetchJson('/api/marketing/forms', { method: 'GET' });
}

export function upsertMarketingForm(payload) {
  return fetchJson('/api/marketing/forms', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listMarketingLeads({ stage = null, minScore = null, limit = 200, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (stage) params.set('stage', String(stage));
  if (minScore != null) params.set('minScore', String(minScore));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/leads${qs}`, { method: 'GET' });
}

export function getMarketingLeadStats() {
  return fetchJson('/api/marketing/leads/stats', { method: 'GET' });
}

export function listMarketingScoringRules() {
  return fetchJson('/api/marketing/scoring-rules', { method: 'GET' });
}

export function upsertMarketingScoringRule(payload) {
  return fetchJson('/api/marketing/scoring-rules', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createMarketingEmailCampaign(payload) {
  return fetchJson('/api/marketing/email-campaigns', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function sendMarketingEmailCampaign(campaignId, limit = 2000) {
  const qs = `?limit=${encodeURIComponent(String(limit))}`;
  return fetchJson(`/api/marketing/email-campaigns/${encodeURIComponent(String(campaignId))}/send${qs}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function listMarketingLinks({ limit = 200, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/links${qs}`, { method: 'GET' });
}

export function createMarketingLink(payload) {
  return fetchJson('/api/marketing/links', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
