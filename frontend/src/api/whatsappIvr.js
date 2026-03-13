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

export function upsertWhatsAppIvrDepartment(payload) {
  return fetchJson('/whatsapp/ivr/department', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function upsertWhatsAppIvrRule(payload) {
  return fetchJson('/whatsapp/ivr/rule', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
