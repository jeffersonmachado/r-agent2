import { fetchJson } from './client';

/**
 * API client do CICLO DE BUG do Engineering Router (DEVELOPMENT-only — o backend também faz
 * enforcement `requireClassification('DEVELOPMENT')` + RBAC por ação; o frontend nunca é a
 * autoridade de acesso).
 */

function qs(params = {}) {
  return new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
}

export function listEngineeringFindings(params = {}) {
  const query = qs(params);
  return fetchJson(`/engineering/findings${query ? `?${query}` : ''}`);
}

export function getEngineeringFindingsSummary(params = {}) {
  const query = qs(params);
  return fetchJson(`/engineering/findings/summary${query ? `?${query}` : ''}`);
}

export function getEngineeringFinding(findingId) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}`);
}

export function getEngineeringFindingHistory(findingId) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/history`);
}

export function registerEngineeringFinding(payload) {
  return fetchJson('/engineering/findings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function reproduceEngineeringFinding(findingId, payload = {}) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/reproduce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function confirmEngineeringFinding(findingId, payload) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function triageEngineeringFinding(findingId, payload = {}) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function runEngineeringFindingFix(findingId, payload = {}) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function approveEngineeringFindingSelfModification(findingId, payload = {}) {
  return fetchJson(`/engineering/findings/${encodeURIComponent(findingId)}/approve-self-modification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function runEngineeringBugLoopSweep(payload = {}) {
  return fetchJson('/engineering/findings/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
