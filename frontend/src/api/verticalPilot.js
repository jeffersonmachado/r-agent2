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

export function getBeautyAgenda(params = {}) {
  return fetchJson(`/api/beauty/agenda${toQuery(params)}`);
}

export function searchBeautyCustomers(params = {}) {
  return fetchJson(`/api/beauty/customers/search${toQuery(params)}`);
}

export function getBeautyCustomerDetail(subjectId, params = {}) {
  return fetchJson(`/api/beauty/customer/${encodeURIComponent(subjectId)}/detail${toQuery(params)}`);
}

export function sendBeautyFollowUp(payload = {}) {
  return fetchJson('/api/beauty/follow-up', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function markBeautyServiceCompleted(payload = {}) {
  return fetchJson('/api/beauty/service-completed', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function markBeautyNoShow(payload = {}) {
  return fetchJson('/api/beauty/no-show', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function searchFitnessStudents(params = {}) {
  return fetchJson(`/api/fitness/students/search${toQuery(params)}`);
}

export function getFitnessStudentDetail(subjectId, params = {}) {
  return fetchJson(`/api/fitness/student/${encodeURIComponent(subjectId)}/detail${toQuery(params)}`);
}

export function registerFitnessCheckIn(payload = {}) {
  return fetchJson('/api/fitness/attendance/check-in', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function registerFitnessCheckOut(payload = {}) {
  return fetchJson('/api/fitness/attendance/check-out', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateFitnessMembershipBilling(membershipId, payload = {}) {
  return fetchJson(`/api/fitness/membership/${encodeURIComponent(membershipId)}/billing`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}
