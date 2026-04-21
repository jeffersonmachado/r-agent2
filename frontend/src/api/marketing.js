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

export function getMarketingGoogleAdsSettings() {
  return fetchJson('/api/marketing/google-ads/settings', { method: 'GET' });
}

export function saveMarketingGoogleAdsSettings(payload) {
  return fetchJson('/api/marketing/google-ads/settings', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listMarketingGoogleAdsConversions({ status = null, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', String(status));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/conversions${qs}`, { method: 'GET' });
}

export function createMarketingGoogleAdsConversion(payload) {
  return fetchJson('/api/marketing/google-ads/conversions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function uploadMarketingGoogleAdsConversions(limit = 50) {
  const qs = `?limit=${encodeURIComponent(String(limit))}`;
  return fetchJson(`/api/marketing/google-ads/conversions/upload${qs}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function syncMarketingGoogleAdsKeywordPerformance(payload) {
  return fetchJson('/api/marketing/google-ads/keywords/sync', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listMarketingGoogleAdsKeywordPerformance({ startDate = null, endDate = null, campaignId = null, adGroupId = null, matchType = null, sortBy = 'cost', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', String(startDate));
  if (endDate) params.set('endDate', String(endDate));
  if (campaignId) params.set('campaignId', String(campaignId));
  if (adGroupId) params.set('adGroupId', String(adGroupId));
  if (matchType) params.set('matchType', String(matchType));
  if (sortBy) params.set('sortBy', String(sortBy));
  if (sortOrder) params.set('sortOrder', String(sortOrder));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/keywords/performance${qs}`, { method: 'GET' });
}

export function listMarketingGoogleAdsSearchTermPerformance({ startDate = null, endDate = null, campaignId = null, adGroupId = null, sortBy = 'cost', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', String(startDate));
  if (endDate) params.set('endDate', String(endDate));
  if (campaignId) params.set('campaignId', String(campaignId));
  if (adGroupId) params.set('adGroupId', String(adGroupId));
  if (sortBy) params.set('sortBy', String(sortBy));
  if (sortOrder) params.set('sortOrder', String(sortOrder));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/search-terms/performance${qs}`, { method: 'GET' });
}

export function getMarketingGoogleAdsRoi({ startDate = null, endDate = null, campaignId = null, adGroupId = null, entity = 'campaign', sortBy = 'conversionValue', sortOrder = 'desc', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', String(startDate));
  if (endDate) params.set('endDate', String(endDate));
  if (campaignId) params.set('campaignId', String(campaignId));
  if (adGroupId) params.set('adGroupId', String(adGroupId));
  if (entity) params.set('entity', String(entity));
  if (sortBy) params.set('sortBy', String(sortBy));
  if (sortOrder) params.set('sortOrder', String(sortOrder));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/roi${qs}`, { method: 'GET' });
}

export function getMarketingGoogleAdsAttributionExceptions({ windowDays = 7, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (windowDays != null) params.set('windowDays', String(windowDays));
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/attribution-exceptions${qs}`, { method: 'GET' });
}

export function analyzeMarketingGoogleAdsKeywords(payload) {
  return fetchJson('/api/marketing/google-ads/keywords/analyze', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function applyMarketingGoogleAdsKeywordAction(payload) {
  return fetchJson('/api/marketing/google-ads/keywords/actions/apply', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function syncMarketingGoogleAdsRecommendations(payload) {
  return fetchJson('/api/marketing/google-ads/recommendations/sync', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listMarketingGoogleAdsRecommendations({ status = null, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', String(status));
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/marketing/google-ads/recommendations${qs}`, { method: 'GET' });
}

export function updateMarketingGoogleAdsRecommendation(recommendationId, payload) {
  return fetchJson(`/api/marketing/google-ads/recommendations/${encodeURIComponent(String(recommendationId))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function applyMarketingGoogleAdsRecommendation(recommendationId, payload) {
  return fetchJson(`/api/marketing/google-ads/recommendations/${encodeURIComponent(String(recommendationId))}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
