import { fetchJson } from './client';

/**
 * API client das Engineering Missions (DEVELOPMENT-only — o backend também enforcement
 * `requireClassification('DEVELOPMENT')`, o frontend nunca é a autoridade).
 */

export function listEngineeringMissions(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return fetchJson(`/engineering/missions${query ? `?${query}` : ''}`);
}

export function getEngineeringMissionsOverview() {
  return fetchJson('/engineering/missions/overview');
}

export function compileEngineeringMission(payload) {
  return fetchJson('/engineering/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getEngineeringMission(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}`);
}

export function getEngineeringMissionPreview(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/preview`);
}

export function getEngineeringMissionVersions(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/versions`);
}

export function getEngineeringMissionApprovals(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/approvals`);
}

export function reEnrichEngineeringMission(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function approveEngineeringMission(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function rejectEngineeringMission(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function editEngineeringMission(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function executeEngineeringMission(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getEngineeringMissionReport(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/report`);
}

export function getEngineeringMissionPolicy() {
  return fetchJson('/engineering/missions/policy');
}

export function setEngineeringMissionPolicy(policy) {
  return fetchJson('/engineering/missions/policy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  });
}

export function resumeInterruptedEngineeringMissions() {
  return fetchJson('/engineering/missions/resume-interrupted', { method: 'POST' });
}

/** Meta Review (§23) e Adversarial Review (§24) — findings objetivos, persistidos. */
export function runEngineeringMissionReview(missionId, payload = {}) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getEngineeringMissionReview(missionId) {
  return fetchJson(`/engineering/missions/${encodeURIComponent(missionId)}/review`);
}

/** Autoavaliação contínua (§45). `persist=1` grava o retrato em reports/. */
export function getEngineeringMissionSelfAssessment({ persist = false, limit } = {}) {
  const query = new URLSearchParams({
    ...(persist ? { persist: '1' } : {}),
    ...(limit ? { limit: String(limit) } : {}),
  }).toString();
  return fetchJson(`/engineering/missions/self-assessment${query ? `?${query}` : ''}`);
}
