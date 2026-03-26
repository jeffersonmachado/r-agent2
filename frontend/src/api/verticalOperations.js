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

export function listFitnessMemberships(params = {}) {
  return fetchJson(`/api/fitness/memberships${toQuery(params)}`);
}

export function chargeFitnessMembership(membershipId, payload = {}) {
  return fetchJson(`/api/fitness/membership/${encodeURIComponent(membershipId)}/charge`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listOpenFitnessAttendances(params = {}) {
  return fetchJson(`/api/fitness/attendance/open${toQuery(params)}`);
}

export function listBeautyBundles(params = {}) {
  return fetchJson(`/api/beauty/bundles${toQuery(params)}`);
}

export function createBeautyBundle(payload = {}) {
  return fetchJson('/api/beauty/bundle', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createBillingCharge(payload = {}) {
  return fetchJson('/billing/create-charge', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getFitnessDashboard(params = {}) {
  return fetchJson(`/api/fitness/dashboard${toQuery(params)}`);
}

export function getBeautyDashboard(params = {}) {
  return fetchJson(`/api/beauty/dashboard${toQuery(params)}`);
}

export function getFitnessIntelligence(subjectId) {
  return fetchJson(`/api/fitness/intelligence/${encodeURIComponent(subjectId)}`);
}

export function getBeautyIntelligence(subjectId) {
  return fetchJson(`/api/beauty/intelligence/${encodeURIComponent(subjectId)}`);
}
