import { fetchJson } from './client';

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getFitnessDashboard() {
  return fetchJson('/api/fitness/dashboard', { method: 'GET' });
}

export function createFitnessClass(payload = {}) {
  return fetchJson('/api/fitness/classes', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessProfessional(payload = {}) {
  return fetchJson('/api/fitness/professionals', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessResource(payload = {}) {
  return fetchJson('/api/fitness/resources', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function saveFitnessActivityProfessional(payload = {}) {
  return fetchJson('/api/fitness/activity-professionals', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function saveFitnessActivityResource(payload = {}) {
  return fetchJson('/api/fitness/activity-resources', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessSchedule(payload = {}) {
  return fetchJson('/api/fitness/schedules', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessMembership(payload = {}) {
  return fetchJson('/api/fitness/memberships', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function saveFitnessAttendance(payload = {}) {
  return fetchJson('/api/fitness/attendance', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessGoal(payload = {}) {
  return fetchJson('/api/fitness/goals', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function createFitnessCheckin(payload = {}) {
  return fetchJson('/api/fitness/checkins', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listFitnessClasses(filters = {}) {
  return fetchJson(`/api/fitness/classes${toQuery(filters)}`, { method: 'GET' });
}

export function listFitnessSchedules(filters = {}) {
  return fetchJson(`/api/fitness/schedules${toQuery(filters)}`, { method: 'GET' });
}

export function listFitnessMemberships(filters = {}) {
  return fetchJson(`/api/fitness/memberships${toQuery(filters)}`, { method: 'GET' });
}

export function listFitnessAttendance(filters = {}) {
  return fetchJson(`/api/fitness/attendance${toQuery(filters)}`, { method: 'GET' });
}
