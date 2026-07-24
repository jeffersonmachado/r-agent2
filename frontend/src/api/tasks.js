import { fetchJson } from './client';

export function listTasks() {
  return fetchJson('/api/tasks', { method: 'GET' });
}

export function createTask(payload) {
  return fetchJson('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function completeTask(id) {
  return fetchJson(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' });
}

export function scheduleTaskReminder(id, payload) {
  return fetchJson(`/api/tasks/${encodeURIComponent(id)}/reminder`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
