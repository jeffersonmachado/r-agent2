import { fetchJson } from './client';

/**
 * Verifica se o onboarding está bloqueando o acesso.
 * Retorna { blocking: boolean, missingSteps: string[] }
 */
export async function getOnboardingCheck() {
  return fetchJson('/onboarding/check', {
    method: 'GET',
  });
}

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
export async function createInitialTemplates(options = undefined) {
  const hasBody = !!(options && typeof options === 'object' && Object.keys(options).length > 0);
  return fetchJson('/onboarding/create-templates', {
    method: 'POST',
    ...(hasBody ? { body: JSON.stringify(options) } : {}),
  });
}
