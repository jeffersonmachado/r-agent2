import { fetchJson } from './client';

export function listOrders(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.append('status', options.status);
  if (options.limit) params.append('limit', String(options.limit));
  if (options.offset) params.append('offset', String(options.offset));
  const q = params.toString();
  return fetchJson(`/orders${q ? `?${q}` : ''}`, { method: 'GET' });
}

export function getOrder(orderId) {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
}

export function updateOrderStatus(orderId, status) {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

