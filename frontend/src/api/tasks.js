import { fetchJson } from './client';

export function listTasks() {
  return fetchJson('/tasks', { method: 'GET' });
}

export function createTask(payload) {
  return fetchJson('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function completeTask(id) {
  return fetchJson(`/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' });
}

export function scheduleTaskReminder(id, payload) {
  return fetchJson(`/tasks/${encodeURIComponent(id)}/reminder`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
