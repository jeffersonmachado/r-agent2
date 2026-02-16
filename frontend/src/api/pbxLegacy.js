import { fetchJson } from './client';

export function getPbxHealth() {
  return fetchJson('/api/pbx-legacy/health', { method: 'GET' });
}

export function getPbxInventory() {
  return fetchJson('/api/pbx-legacy/inventory', { method: 'GET' });
}

export function listRamais() {
  return fetchJson('/api/pbx-legacy/ramais', { method: 'GET' });
}

export function upsertRamal(payload) {
  return fetchJson('/api/pbx-legacy/ramais', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listLegacyXmlEntity(entity) {
  const qs = `?entity=${encodeURIComponent(String(entity || ''))}`;
  return fetchJson(`/api/pbx-legacy/xml-entities${qs}`, {
    method: 'GET',
    expectedErrorCodes: ['pbx_xml_dir_not_configured'],
  });
}

export function upsertLegacyXmlEntity(entity, payload) {
  const qs = `?entity=${encodeURIComponent(String(entity || ''))}`;
  return fetchJson(`/api/pbx-legacy/xml-entities${qs}`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
    expectedErrorCodes: ['pbx_xml_dir_not_configured'],
  });
}

export function deleteLegacyXmlEntity(entity, id) {
  const qs = `?entity=${encodeURIComponent(String(entity || ''))}&id=${encodeURIComponent(String(id || ''))}`;
  return fetchJson(`/api/pbx-legacy/xml-entities${qs}`, {
    method: 'DELETE',
    expectedErrorCodes: ['pbx_xml_dir_not_configured'],
  });
}
