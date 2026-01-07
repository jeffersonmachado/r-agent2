import { fetchJson } from './client';

/**
 * Obtém status de onboarding do tenant
 */
export async function getOnboardingStatus() {
  return fetchJson('/onboarding/status', {
    method: 'GET',
  });
}

/**
 * Inicia processo de onboarding
 */
export async function startOnboarding() {
  return fetchJson('/onboarding/start', {
    method: 'POST',
  });
}

/**
 * Completa um step do onboarding
 */
export async function completeOnboardingStep(stepId) {
  return fetchJson('/onboarding/complete-step', {
    method: 'POST',
    body: JSON.stringify({ stepId }),
  });
}

/**
 * Finaliza onboarding
 */
export async function completeOnboarding() {
  return fetchJson('/onboarding/complete', {
    method: 'POST',
  });
}

/**
 * Cria templates iniciais
 */
export async function createInitialTemplates() {
  return fetchJson('/onboarding/create-templates', {
    method: 'POST',
  });
}
