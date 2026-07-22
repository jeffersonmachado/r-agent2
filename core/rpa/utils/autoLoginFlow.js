/**
 * Fluxo reutilizável de auto-login para execuções RPA:
 * - Navega para a URL inicial (preferindo o primeiro step "navigate")
 * - Aplica autenticação automática (token RPA com fallback UI)
 *
 * Mantém a mesma semântica usada pelos runners/players, mas centraliza
 * o comportamento para evitar duplicação.
 */

const rpaConfig = require('../rpaConfig');
const { ensureAuthenticated, handleTenantSelectorModalIfPresent } = require('./authHelper');

function resolveFrontendBaseUrl(frontendBaseUrl) {
  return (
    frontendBaseUrl ||
    process.env.TEST_FRONTEND_URL ||
    rpaConfig.urls?.frontend ||
    'http://localhost:5173'
  );
}

function resolveApiBaseUrl(apiBaseUrl) {
  return (
    apiBaseUrl ||
    process.env.TEST_API_URL ||
    process.env.API_URL ||
    process.env.API_BASE_URL ||
    rpaConfig.urls?.api ||
    'http://localhost:3001'
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

/**
 * Normaliza URL gravada (ex.: localhost:5173) para o baseUrl de teste atual.
 * Idêntica à lógica de reescrita em actionExecutor.executeNavigate.
 */
function normalizeRecordedUrlToBase(url, baseUrl) {
  if (!url || typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    const asPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      asPort === '5173'
    ) {
      const base = new URL(baseUrl);
      parsed.protocol = base.protocol;
      parsed.hostname = base.hostname;
      parsed.port = base.port;
      return parsed.toString();
    }
    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      (asPort === '3000' || asPort === '3001')
    ) {
      // URL de API gravada — não é frontend, não normalizar para baseUrl
    }
  } catch (_) {}
  return url;
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
  const hasPermissionHint = /sem permiss|acesso negado|forbidden|unauthorized|erro 403|status 403|http 403|\b403\b/.test(snapshot.bodyText || '');

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
  const apiBaseUrl = resolveApiBaseUrl(params.apiBaseUrl || params.authOptions?.apiBaseUrl);
  const rawTargetUrl = resolveTargetUrlFromFirstStep(params.firstStep);
  const resolvedTemplateData = {
    ...templateData,
    urls: {
      ...(templateData.urls || {}),
      frontend: templateData?.urls?.frontend || baseUrl,
    },
  };
  const maybeTargetUrl = replaceTemplateVariables(rawTargetUrl, resolvedTemplateData, { frontendBaseUrl: baseUrl });
  const rawNormalizedUrl = typeof maybeTargetUrl === 'string' && /\{\{[^}]+\}\}/.test(maybeTargetUrl)
    ? baseUrl
    : maybeTargetUrl;
  // Normaliza URL gravada (ex.: localhost:5173) para o baseUrl do ambiente de teste
  // para evitar que shouldAutoLoginForTarget retorne false por porta diferente.
  const targetUrl = normalizeRecordedUrlToBase(rawNormalizedUrl, baseUrl);
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
    apiBaseUrl,
    // Ajuda o fluxo de pós-login a navegar corretamente
    frontendBaseUrl: baseUrl,
  });

  if (authResult.success && authResult.loggedIn && targetUrl && allowAutoLoginForTarget) {
    const targetPath = (() => {
      try { return new URL(targetUrl).pathname; } catch (_) { return null; }
    })();
    // Sempre recarrega a rota alvo após o login: em rotas protegidas o app pode
    // manter a URL original enquanto renderiza o Login, e o componente Login
    // redireciona para /workspace de forma assíncrona — confiar na URL atual
    // cria corrida (observado: /dev/qa-waves caindo em /workspace sob carga).
    // Retry único com resolução do modal de tenant se o app redirecionar.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      } catch (error) {
        return {
          success: false,
          loggedIn: true,
          error: `Login realizado, mas falhou ao retornar para a rota alvo "${targetUrl}": ${error.message}`,
          baseUrl,
          targetUrl,
        };
      }

      // Aguarda a SPA assentar (redirects tardios de Login/guards de rota).
      await page.waitForTimeout(Math.max(waitAfterGotoMs, 2500));

      const landedUrl = typeof page.url === 'function' ? page.url() : null;
      const landedPath = (() => {
        try { return new URL(landedUrl).pathname; } catch (_) { return landedUrl; }
      })();
      if (!targetPath || landedPath === targetPath) break;
      if (attempt < 2) {
        await handleTenantSelectorModalIfPresent(page, { timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(500);
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
