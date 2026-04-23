import { fetchJson } from './client';

export function listProjects(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') search.set(key, value);
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return fetchJson(`/projects${suffix}`, { method: 'GET' });
}

export function createProject(payload) {
  return fetchJson('/projects', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function getProject(projectId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'GET' });
}

export function updateProject(projectId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

export function listProjectLists(projectId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/lists`, { method: 'GET' });
}

export function createProjectItem(projectId, payload) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listProjectItems(projectId, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') search.set(key, value);
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/items${suffix}`, { method: 'GET' });
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
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/dashboard`, { method: 'GET' });
}

export function getProjectTimeline(projectId) {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/timeline`, { method: 'GET' });
}

export function listProjectActivities(projectId, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') search.set(key, value);
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/activities${suffix}`, { method: 'GET' });
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
