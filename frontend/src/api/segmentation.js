import { fetchJson } from './client';

export async function getAllTags() {
  return fetchJson('/segmentation/tags');
}

export async function getAllCategories() {
  return fetchJson('/segmentation/categories');
}

export async function filterTickets(filters = {}) {
  const params = new URLSearchParams();
  if (filters.tags) params.append('tags', Array.isArray(filters.tags) ? filters.tags.join(',') : filters.tags);
  if (filters.category) params.append('category', filters.category);
  if (filters.status) params.append('status', filters.status);
  if (filters.queue) params.append('queue', filters.queue);
  if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.search) params.append('search', filters.search);
  
  const query = params.toString();
  return fetchJson(`/segmentation/tickets${query ? `?${query}` : ''}`);
}

export async function getSegmentationStats(filters = {}) {
  const params = new URLSearchParams();
  if (filters.tags) params.append('tags', Array.isArray(filters.tags) ? filters.tags.join(',') : filters.tags);
  if (filters.category) params.append('category', filters.category);
  if (filters.status) params.append('status', filters.status);
  if (filters.queue) params.append('queue', filters.queue);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  
  const query = params.toString();
  return fetchJson(`/segmentation/stats${query ? `?${query}` : ''}`);
}

export async function addTagToTicket(ticketId, tag) {
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  });
}

export async function removeTagFromTicket(ticketId, tag) {
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
}

export async function setTicketCategory(ticketId, category) {
  return fetchJson(`/tickets/${encodeURIComponent(ticketId)}/category`, {
    method: 'PUT',
    body: JSON.stringify({ category }),
  });
}

