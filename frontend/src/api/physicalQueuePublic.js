import { fetchPublicJson } from './publicClient';

export function resolvePublicToken(token) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/public-tokens/resolve?${qs}`, { method: 'GET' });
}

export function createPhysicalTicket(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/kiosk/tickets?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getPanelState(token) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/panel/state?${qs}`, { method: 'GET' });
}

export function callNext(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/call-next?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function finishPhysicalTicket(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/finish?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function startPhysicalService(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/start?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function skipPhysicalTicket(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/skip?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function transferPhysicalTicket(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/transfer?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function abandonPhysicalTicket(token, payload = {}) {
  const qs = new URLSearchParams({ token }).toString();
  return fetchPublicJson(`/physical/station/abandon?${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

