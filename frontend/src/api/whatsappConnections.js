export function deleteWhatsAppConnection(connectionId) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
}
import { fetchJson } from './client';

export function listWhatsAppConnections() {
  return fetchJson('/whatsapp/connections', { method: 'GET' });
}

export function createWhatsAppConnection(payload) {
  return fetchJson('/whatsapp/connections', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function updateWhatsAppConnection(connectionId, payload) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
}

export function generateWhatsAppQr(connectionId) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}/qr`, {
    method: 'POST',
  });
}

export function disconnectWhatsAppConnection(connectionId) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}/disconnect`, {
    method: 'POST',
  });
}

export function getWhatsAppConnectionStatus(connectionId) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}/status`, {
    method: 'GET',
  });
}

export function updateWhatsAppConnectionStatus(connectionId, payload) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}/status`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function postWhatsAppConnectionEvent(connectionId, payload) {
  return fetchJson(`/whatsapp/connections/${encodeURIComponent(connectionId)}/events`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
