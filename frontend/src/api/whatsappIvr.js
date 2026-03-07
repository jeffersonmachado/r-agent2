import { fetchJson } from './client';

export function getWhatsAppIvr() {
  return fetchJson('/whatsapp/ivr', { method: 'GET' });
}

export function updateWhatsAppIvr(payload) {
  return fetchJson('/whatsapp/ivr', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
