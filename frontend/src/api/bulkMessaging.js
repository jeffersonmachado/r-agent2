import { fetchJson } from './client';

export async function listCampaigns(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.createdBy) params.append('createdBy', filters.createdBy);
  
  const query = params.toString();
  return fetchJson(`/bulk-campaigns${query ? `?${query}` : ''}`);
}

export async function getCampaign(id) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}`);
}

export async function createCampaign(data) {
  return fetchJson('/bulk-campaigns', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCampaign(id, data) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCampaign(id) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function startCampaign(id) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  });
}

export async function pauseCampaign(id) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
  });
}

export async function resumeCampaign(id) {
  return fetchJson(`/bulk-campaigns/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  });
}
