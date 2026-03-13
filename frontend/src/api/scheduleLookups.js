import { fetchJson } from './client';

export async function searchScheduleUsers(query, limit = 10) {
  const q = String(query || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  const out = await fetchJson(`/api/users/search?${params.toString()}`);
  return Array.isArray(out?.items) ? out.items : [];
}

export async function searchScheduleTeams(query, limit = 20) {
  const q = String(query || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  const out = await fetchJson(`/api/teams/search?${params.toString()}`);
  return Array.isArray(out?.items) ? out.items : [];
}

export async function listSchedulePurposes(search = '', limit = 20) {
  const q = String(search || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('search', q);
  params.set('limit', String(limit));
  const out = await fetchJson(`/api/schedule-purposes?${params.toString()}`);
  return Array.isArray(out?.items) ? out.items : [];
}
