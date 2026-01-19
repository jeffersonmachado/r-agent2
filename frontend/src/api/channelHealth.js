import { fetchJson } from './client';

export async function getChannelHealth(params = {}) {
  const qs = new URLSearchParams();
  if (params.windowMinutes) qs.append('windowMinutes', String(params.windowMinutes));
  const query = qs.toString();
  return fetchJson(`/system/channel-health${query ? `?${query}` : ''}`, { method: 'GET', timeoutMs: 8000 });
}

