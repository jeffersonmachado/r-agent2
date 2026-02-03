/**
 * Fluxo reutilizável de auto-login para execuções RPA:
 * - Navega para a URL inicial (preferindo o primeiro step "navigate")
 * - Aplica autenticação automática (token RPA com fallback UI)
 *
 * Mantém a mesma semântica usada pelos runners/players, mas centraliza
 * o comportamento para evitar duplicação.
 */

const rpaConfig = require('../rpaConfig');
const { ensureAuthenticated } = require('./authHelper');

function resolveFrontendBaseUrl(frontendBaseUrl) {
  return (
    frontendBaseUrl ||
    process.env.TEST_FRONTEND_URL ||
    rpaConfig.urls?.frontend ||
    'http://localhost:5173'
  );
}

function resolveTargetUrlFromFirstStep(firstStep) {
  if (!firstStep || firstStep.type !== 'navigate') return null;
  return firstStep.url || firstStep.value || null;
}

/**
 * Executa navegação inicial + auto-login.
 *
 * @param {Object} page - Página do Playwright
 * @param {Object} params
 * @param {Object} [params.firstStep] - Primeiro step do seed/recording (p/ achar targetUrl)
 * @param {string} [params.frontendBaseUrl] - Base URL do frontend (override)
 * @param {Object} [params.authOptions] - Opções repassadas para ensureAuthenticated
 * @param {number} [params.navigationTimeoutMs]
 * @param {number} [params.waitAfterGotoMs]
 * @returns {Promise<{success: boolean, loggedIn: boolean, error?: string, baseUrl: string, targetUrl?: string|null}>}
 */
async function autoLoginBeforeSteps(page, params = {}) {
  const navigationTimeoutMs = params.navigationTimeoutMs || 30000;
  const waitAfterGotoMs = params.waitAfterGotoMs || 1000;

  const baseUrl = resolveFrontendBaseUrl(params.frontendBaseUrl);
  const targetUrl = resolveTargetUrlFromFirstStep(params.firstStep);

  if (!page) {
    return {
      success: false,
      loggedIn: false,
      error: 'Página Playwright não disponível para auto-login',
      baseUrl,
      targetUrl,
    };
  }

  // Navega primeiro (preferindo a URL do primeiro step)
  try {
    if (targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    } else {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    }
  } catch (error) {
    // Se falhar, tenta navegar para a URL base
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
  }

  await page.waitForTimeout(waitAfterGotoMs);

  // Garante autenticação (token RPA -> fallback UI)
  const authResult = await ensureAuthenticated(page, {
    ...(params.authOptions || {}),
    // Ajuda o fluxo de pós-login a navegar corretamente
    frontendBaseUrl: baseUrl,
  });

  return {
    ...authResult,
    baseUrl,
    targetUrl,
  };
}

module.exports = {
  autoLoginBeforeSteps,
  resolveFrontendBaseUrl,
  resolveTargetUrlFromFirstStep,
};

