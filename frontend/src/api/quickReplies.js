import { fetchJson } from './client';

export async function listQuickReplies(filters = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.append('category', filters.category);
  if (filters.tag) params.append('tag', filters.tag);
  if (filters.activeOnly !== undefined) params.append('activeOnly', filters.activeOnly);
  if (filters.search) params.append('search', filters.search);
  
  const query = params.toString();
  return fetchJson(`/quick-replies${query ? `?${query}` : ''}`);
}

export async function getQuickReply(id) {
  return fetchJson(`/quick-replies/${encodeURIComponent(id)}`);
}

export async function createQuickReply(data) {
  return fetchJson('/quick-replies', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateQuickReply(id, data) {
  return fetchJson(`/quick-replies/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteQuickReply(id) {
  return fetchJson(`/quick-replies/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function searchQuickReplies(context, limit = 5) {
  return fetchJson('/quick-replies/search', {
    method: 'POST',
    body: JSON.stringify({ context, limit }),
  });
}

export async function getCategories() {
  return fetchJson('/quick-replies/categories');
}

export async function getTags() {
  return fetchJson('/quick-replies/tags');
}

export async function useQuickReply(id) {
  return fetchJson(`/quick-replies/${encodeURIComponent(id)}/use`, {
    method: 'POST',
  });
}
