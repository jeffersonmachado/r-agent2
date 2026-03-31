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

function replaceTemplateVariables(str, data = {}, options = {}) {
  if (typeof str !== 'string' || !str.trim()) return str;

  const frontendBaseUrl = options.frontendBaseUrl || data?.urls?.frontend || null;

  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = String(key || '').trim().split('.');
    let value = data;

    for (const currentKey of keys) {
      if (value && typeof value === 'object' && currentKey in value) {
        value = value[currentKey];
      } else {
        // Fallback explícito para placeholders comuns de URL usados nos seeds RPA.
        if (String(key || '').trim() === 'urls.frontend' && frontendBaseUrl) {
          return String(frontendBaseUrl);
        }
        return match;
      }
    }

    return value !== undefined && value !== null ? String(value) : match;
  });
}

function shouldAutoLoginForTarget(targetUrl, baseUrl) {
  if (!targetUrl) return true;

  try {
    const parsedBase = new URL(baseUrl);
    const parsedTarget = new URL(targetUrl, parsedBase);
    return parsedBase.origin === parsedTarget.origin;
  } catch (_) {
    return true;
  }
}

function isMaintenanceTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  return targetUrl.includes('/maintenance');
}

async function validateMaintenancePostLoginState(page) {
  const currentUrl = typeof page.url === 'function' ? page.url() : '';
  const snapshot = await page.evaluate(() => {
    const bodyText = String(document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const has = (selector) => !!document.querySelector(selector);

    const localKeys = Object.keys(window.localStorage || {});
    const sessionKeys = Object.keys(window.sessionStorage || {});
    const keys = [...localKeys, ...sessionKeys].map((k) => String(k).toLowerCase());

    const hasAnyKey = (names) => names.some((name) => keys.some((key) => key === name || key.includes(name)));

    return {
      hasMaintenancePage: has('[data-testid="ticket-maintenance-page"]'),
      hasAppShell: has('[data-testid="app-shell"]'),
      hasLoading: has('[data-testid="ticket-maintenance-loading"]'),
      hasReady: has('[data-testid="ticket-maintenance-ready"]'),
      hasAuthRequired: has('[data-testid="ticket-maintenance-auth-required"]'),
      hasError: has('[data-testid="ticket-maintenance-error"]'),
      loginFormVisible: has('input[type="password"]') && (has('input[name="username"]') || has('input[name="email"]') || has('input[type="email"]') || has('input[type="text"]')),
      hasAuthToken: hasAnyKey(['auth_token', 'token', 'auth']),
      hasTenantContext: hasAnyKey(['tenant', 'selectedtenant', 'tenantid', 'context']),
      bodyText,
      localStorageKeys: localKeys,
      sessionStorageKeys: sessionKeys,
    };
  });

  const hasMaintenanceUrl = String(currentUrl).includes('/maintenance');
  const hasLoginUrl = String(currentUrl).includes('/login');
  const hasPermissionHint = /sem permiss|acesso negado|forbidden|unauthorized|403/.test(snapshot.bodyText || '');

  let classification = null;
  if (hasLoginUrl || snapshot.loginFormVisible || !snapshot.hasAuthToken) {
    classification = 'auth_redirect';
  } else if (snapshot.hasAuthRequired || hasPermissionHint) {
    classification = 'permission_block';
  } else if (!hasMaintenanceUrl || !snapshot.hasMaintenancePage) {
    classification = snapshot.hasLoading ? 'loading_stuck' : 'maintenance_not_rendered';
  }

  return {
    ok: !classification,
    classification,
    checks: {
      hasMaintenanceUrl,
      hasLoginUrl,
      hasMaintenancePage: snapshot.hasMaintenancePage,
      hasAppShell: snapshot.hasAppShell,
      hasReady: snapshot.hasReady,
      hasLoading: snapshot.hasLoading,
      hasAuthRequired: snapshot.hasAuthRequired,
      hasError: snapshot.hasError,
      hasAuthToken: snapshot.hasAuthToken,
      hasTenantContext: snapshot.hasTenantContext,
    },
    storage: {
      localStorageKeys: snapshot.localStorageKeys,
      sessionStorageKeys: snapshot.sessionStorageKeys,
    },
  };
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
  const templateData = params.templateData || {};

  const baseUrl = resolveFrontendBaseUrl(params.frontendBaseUrl);
  const rawTargetUrl = resolveTargetUrlFromFirstStep(params.firstStep);
  const resolvedTemplateData = {
    ...templateData,
    urls: {
      ...(templateData.urls || {}),
      frontend: templateData?.urls?.frontend || baseUrl,
    },
  };
  const maybeTargetUrl = replaceTemplateVariables(rawTargetUrl, resolvedTemplateData, { frontendBaseUrl: baseUrl });
  const targetUrl = typeof maybeTargetUrl === 'string' && /\{\{[^}]+\}\}/.test(maybeTargetUrl)
    ? baseUrl
    : maybeTargetUrl;
  const autoLoginEnabled = params.autoLogin !== false;
  const allowAutoLoginForTarget = shouldAutoLoginForTarget(targetUrl, baseUrl);

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

  if (!autoLoginEnabled) {
    return {
      success: true,
      loggedIn: false,
      skipped: true,
      skipReason: 'auto_login_disabled',
      baseUrl,
      targetUrl,
    };
  }

  if (!allowAutoLoginForTarget) {
    return {
      success: true,
      loggedIn: false,
      skipped: true,
      skipReason: 'external_target_url',
      baseUrl,
      targetUrl,
    };
  }

  // Garante autenticação (token RPA -> fallback UI)
  const authResult = await ensureAuthenticated(page, {
    ...(params.authOptions || {}),
    // Ajuda o fluxo de pós-login a navegar corretamente
    frontendBaseUrl: baseUrl,
  });

  if (authResult.success && authResult.loggedIn && targetUrl && allowAutoLoginForTarget) {
    const currentUrl = typeof page.url === 'function' ? page.url() : null;
    if (currentUrl !== targetUrl) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
        await page.waitForTimeout(Math.min(waitAfterGotoMs, 1000));
      } catch (error) {
        return {
          success: false,
          loggedIn: true,
          error: `Login realizado, mas falhou ao retornar para a rota alvo "${targetUrl}": ${error.message}`,
          baseUrl,
          targetUrl,
        };
      }
    }
  }

  if (authResult.success && authResult.loggedIn && isMaintenanceTarget(targetUrl)) {
    const gate = await validateMaintenancePostLoginState(page);
    if (!gate.ok) {
      return {
        success: false,
        loggedIn: true,
        error: `maintenance_auth_gate_failed:${gate.classification}`,
        classification: gate.classification,
        diagnostics: gate,
        baseUrl,
        targetUrl,
      };
    }
    return {
      ...authResult,
      maintenanceGate: gate,
      baseUrl,
      targetUrl,
    };
  }

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
  replaceTemplateVariables,
  shouldAutoLoginForTarget,
};
