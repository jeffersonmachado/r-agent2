import { fetchJson } from './client';

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.append(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const listWorkspaceEntities = (params = {}) => fetchJson(`/workspace/entities${buildQuery(params)}`, { method: 'GET' });
export const getWorkspaceEntity = (entityId) => fetchJson(`/workspace/entities/${encodeURIComponent(entityId)}`, { method: 'GET' });
export const createWorkspaceEntity = (payload = {}) => fetchJson('/workspace/entities', { method: 'POST', body: JSON.stringify(payload) });
export const linkWorkspaceEntity = (payload = {}) => fetchJson('/workspace/links', { method: 'POST', body: JSON.stringify(payload) });
export const getWorkspaceTimeline = (entityId, params = {}) => fetchJson(`/workspace/entities/${encodeURIComponent(entityId)}/timeline${buildQuery(params)}`, { method: 'GET' });
export const getWorkspaceInsights = (entityId) => fetchJson(`/workspace/entities/${encodeURIComponent(entityId)}/insights`, { method: 'GET' });
export const getWorkspaceActions = (entityId) => fetchJson(`/workspace/entities/${encodeURIComponent(entityId)}/actions`, { method: 'GET' });
export const createWorkspaceAction = (payload = {}) => fetchJson('/workspace/actions', { method: 'POST', body: JSON.stringify(payload) });
export const executeWorkspaceAutoActions = (entityId) => fetchJson(`/workspace/entities/${encodeURIComponent(entityId)}/actions/auto`, { method: 'POST', body: JSON.stringify({}) });
export const listWorkspaceTasks = (params = {}) => fetchJson(`/workspace/tasks${buildQuery(params)}`, { method: 'GET' });
export const createWorkspaceTask = (payload = {}) => fetchJson('/workspace/tasks', { method: 'POST', body: JSON.stringify(payload) });
export const listTimesheet = (params = {}) => fetchJson(`/timesheet${buildQuery(params)}`, { method: 'GET' });
export const createTimesheet = (payload = {}) => fetchJson('/timesheet', { method: 'POST', body: JSON.stringify(payload) });
export const listResources = (params = {}) => fetchJson(`/resources${buildQuery(params)}`, { method: 'GET' });
export const createResource = (payload = {}) => fetchJson('/resources', { method: 'POST', body: JSON.stringify(payload) });
export const createResourceAvailability = (payload = {}) => fetchJson('/resources/availability', { method: 'POST', body: JSON.stringify(payload) });
export const listResourceBookings = (params = {}) => fetchJson(`/resource-bookings${buildQuery(params)}`, { method: 'GET' });
export const createResourceBooking = (payload = {}) => fetchJson('/resource-bookings', { method: 'POST', body: JSON.stringify(payload) });
export const listPaymentEvents = (params = {}) => fetchJson(`/payment-events${buildQuery(params)}`, { method: 'GET' });
export const createPaymentEvent = (payload = {}) => fetchJson('/payment-events', { method: 'POST', body: JSON.stringify(payload) });
