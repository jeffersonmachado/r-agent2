import { fetchJson } from './client';

function toQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export function listBeautyServices() {
  return fetchJson('/api/beauty/services');
}

export function listBeautyCampaigns(params = {}) {
  return fetchJson(`/api/marketing/email-campaigns${toQuery(params)}`);
}

export function createBeautyCampaign(payload = {}) {
  return fetchJson('/api/marketing/email-campaigns', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function sendBeautyCampaign(campaignId) {
  return fetchJson(`/api/marketing/email-campaigns/${encodeURIComponent(campaignId)}/send`, {
    method: 'POST',
  });
}

export function listBeautyLeads(params = {}) {
  return fetchJson(`/api/marketing/leads${toQuery(params)}`);
}

export function createBeautyLead(payload = {}) {
  return fetchJson('/api/marketing/leads', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateBeautyLead(leadId, payload = {}) {
  return fetchJson(`/api/marketing/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

export function convertBeautyLead(payload = {}) {
  return fetchJson('/api/beauty/lead/convert', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listBeautyPayments(params = {}) {
  return fetchJson(`/billing/transactions${toQuery({ ...params, vertical: 'beauty' })}`);
}

export function confirmBeautyPayment(payload = {}) {
  return fetchJson('/billing/webhook', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
