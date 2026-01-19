import { fetchJson } from './client';

export async function listChannelAccounts(params = {}) {
  const qs = new URLSearchParams();
  if (params.includeConfig) qs.append('includeConfig', 'true');
  const query = qs.toString();
  return fetchJson(`/channel-accounts${query ? `?${query}` : ''}`, { method: 'GET' });
}

export async function createChannelAccount(data) {
  return fetchJson('/channel-accounts', {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function updateChannelAccount(id, patch) {
  return fetchJson(`/channel-accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch || {}),
  });
}

export async function deleteChannelAccount(id) {
  return fetchJson(`/channel-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function testChannelAccount(id) {
  return fetchJson(`/channel-accounts/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
}

