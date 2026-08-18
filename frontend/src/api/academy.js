import { fetchJson, fetchBlob } from './client';

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

export async function requestTutorHelp(route, level) {
  return fetchJson('/api/learning/tutor/help', {
    method: 'POST',
    body: JSON.stringify({ route, level }),
  });
}

export async function getMyCertifications() {
  return fetchJson('/api/learning/certifications/me');
}

export async function evaluateCertifications() {
  return fetchJson('/api/learning/certifications/evaluate', { method: 'POST' });
}

export async function getMentorPlan() {
  return fetchJson('/api/learning/mentor/plan/me');
}

export async function generateMentorPlan() {
  return fetchJson('/api/learning/mentor/plan/generate', { method: 'POST' });
}

export async function getAnalyticsOverview() {
  return fetchJson('/api/learning/analytics/overview');
}

export async function getReplays() {
  return fetchJson('/api/learning/replays');
}

export async function getManuals() {
  return fetchJson('/api/learning/manuals');
}

export async function generateManualFromReplay(replayId, title) {
  return fetchJson('/api/learning/manuals/from-replay', {
    method: 'POST',
    body: JSON.stringify({ replayId, title }),
  });
}

export function manualMarkdownUrl(manualId) {
  return `/api/learning/manuals/${encodeURIComponent(manualId)}/md`;
}

export function manualImageUrl(manualId, imagePath) {
  const imageName = String(imagePath || '').replace(/^img\//, '');
  return `/api/learning/manuals/${encodeURIComponent(manualId)}/img/${encodeURIComponent(imageName)}`;
}

export async function fetchManualMarkdownBlob(manualId) {
  return fetchBlob(manualMarkdownUrl(manualId));
}

export async function fetchManualImageBlob(manualId, imagePath) {
  return fetchBlob(manualImageUrl(manualId, imagePath));
}

export function manualPdfUrl(manualId) {
  return `/api/learning/manuals/${encodeURIComponent(manualId)}/pdf`;
}

export async function fetchManualPdfBlob(manualId) {
  return fetchBlob(manualPdfUrl(manualId));
}

export async function getJourneyFaqSummary() {
  return fetchJson('/api/learning/journey-faq/summary');
}

export async function getJourneyFaq(journeyKey) {
  return fetchJson(`/api/learning/journey-faq?journeyKey=${encodeURIComponent(journeyKey)}`);
}

export async function generateJourneyFaq(journeyKey, inference) {
  return fetchJson('/api/learning/journey-faq/generate', {
    method: 'POST',
    body: JSON.stringify({ journeyKey, inference: inference === true }),
  });
}

export async function setJourneyFaqStatus(itemId, status) {
  return fetchJson(`/api/learning/journey-faq/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
