import { fetchJson } from './client';

export async function listCloseReasons(filters = {}) {
  const params = new URLSearchParams();
  if (filters.activeOnly !== undefined) params.append('activeOnly', String(filters.activeOnly));
  const query = params.toString();
  return fetchJson(`/close-reasons${query ? `?${query}` : ''}`);
}

