import { fetchPublicJson } from './publicClient';

export function createStorefrontOrder(token, payload) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/storefront/orders?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getStorefrontOrder(token, orderId) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/storefront/orders/${encodeURIComponent(orderId)}?${qs}`, {
    method: 'GET',
  });
}

