/**
 * API Projects Module with Mock Fallback
 * Automatically uses mock data when real API is unavailable
 */

import { fetchJson } from './client';
import mockData from './mock-data.json';

const USE_MOCK_API = localStorage.getItem('USE_MOCK_API') === 'true' || 
                      import.meta.env.REACT_APP_MOCK_API === 'true' ||
                      import.meta.env.DEV === true;

/**
 * Wraps API calls with automatic mock fallback
 */
async function callWithMockFallback(apiFn, mockFn) {
  try {
    const result = await apiFn();
    // Check if response is an error
    if (result && (result.error || result.status >= 400)) {
      console.log('[API Fallback] API error detected, using mock data:', result);
      return mockFn();
    }
    return result;
  } catch (error) {
    console.log('[API Fallback] API call failed, using mock data:', error.message);
    return mockFn();
  }
}

// ─────────────────────────────────────────────────────────────────────────

export function listProjects(params = {}) {
  return callWithMockFallback(
    () => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') search.set(key, value);
      });
      const suffix = search.toString() ? `?${search.toString()}` : '';
      return fetchJson(`/projects${suffix}`, { method: 'GET' });
    },
    () => ({ ok: true, projects: mockData.projects })
  );
}

export function createProject(payload) {
  return fetchJson('/projects', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getProject(projectId) {
  return callWithMockFallback(
    () => fetchJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'GET' }),
    () => ({ ok: true, project: mockData.projects[0] })
  );
}

export function updateProject(projectId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

export function listProjectLists(projectId) {
  return callWithMockFallback(
    () => fetchJson(`/projects/${encodeURIComponent(projectId)}/lists`, { method: 'GET' }),
    () => ({ ok: true, lists: mockData.lists })
  );
}

export function createProjectItem(projectId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listProjectItems(projectId, params = {}) {
  return callWithMockFallback(
    () => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') search.set(key, value);
      });
      const suffix = search.toString() ? `?${search.toString()}` : '';
      return fetchJson(`/projects/${encodeURIComponent(projectId)}/items${suffix}`, { method: 'GET' });
    },
    () => ({ ok: true, items: mockData.items })
  );
}

export function getProjectItem(projectId, itemId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`, { method: 'GET' });
}

export function updateProjectItem(projectId, itemId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

export function moveProjectItem(projectId, itemId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/move`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function completeProjectItem(projectId, itemId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/complete`, {
    method: 'POST',
  });
}

export function listProjectComments(projectId, itemId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/comments`, {
    method: 'GET',
  });
}

export function createProjectComment(projectId, itemId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getProjectDashboard(projectId) {
  return callWithMockFallback(
    () => fetchJson(`/projects/${encodeURIComponent(projectId)}/dashboard`, { method: 'GET' }),
    () => ({ ok: true, dashboard: mockData.dashboard })
  );
}

export function getProjectTimeline(projectId) {
  return callWithMockFallback(
    () => fetchJson(`/projects/${encodeURIComponent(projectId)}/timeline`, { method: 'GET' }),
    () => ({ ok: true, ...mockData.timeline })
  );
}

export function getProjectActivities(projectId, itemId = null) {
  return fetchJson(
    `/projects/${encodeURIComponent(projectId)}/activities${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`,
    { method: 'GET' }
  );
}

export function listProjectActivities(projectId, itemId = null) {
  return getProjectActivities(projectId, itemId);
}

export function listProjectTemplates() {
  return fetchJson('/project-templates', { method: 'GET' });
}

export function createProjectFromTemplate(payload) {
  return fetchJson('/projects/from-template', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
