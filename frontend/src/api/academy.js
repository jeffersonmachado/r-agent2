import { fetchJson } from './client';

export async function getMyCompetencies() {
  return fetchJson('/api/learning/competencies/me');
}

export async function getMyLearningProfile() {
  return fetchJson('/api/learning/profile/me');
}

export async function getSkillGraph() {
  return fetchJson('/api/learning/skill-graph');
}

export async function recomputeCompetencies() {
  return fetchJson('/api/learning/competencies/recompute', { method: 'POST' });
}

export async function getMyMissions() {
  return fetchJson('/api/learning/missions/me');
}

export async function completeMission(missionId) {
  return fetchJson(`/api/learning/missions/${encodeURIComponent(missionId)}/complete`, { method: 'POST' });
}

export async function getSimulations() {
  return fetchJson('/api/learning/simulations');
}
