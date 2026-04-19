const fs = require('fs');
const path = require('path');
const { assertLegacyEntrypointAllowed } = require('../../core/rpa/legacyEntrypointGuard');
const { chromium } = require('playwright');
const { SCREEN_CATALOG } = require('./screenCatalog');
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');
const { launchChromiumWithFallback } = require('../../core/rpa/utils/browserLaunchOptions');

const FRONTEND_URL = String(process.env.TEST_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const API_URL = String(process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const REPORTS_DIR = path.join(__dirname, 'reports');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'screen-catalog');

function parseSelectedScreenIds(argv = process.argv, env = process.env) {
  const cliIds = argv.slice(2).map((value) => String(value || '').trim()).filter(Boolean);
  if (cliIds.length > 0) {
    return cliIds;
  }

  const envValue = env.TEST_SCREEN_IDS || env.TEST_SCREEN_ID || '';
  return String(envValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSelectedScreens(screenCatalog, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return screenCatalog;
  }

  const selectedSet = new Set(selectedIds);
  return screenCatalog.filter((screen) => selectedSet.has(screen.id));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function slugify(value) {
  return String(value || 'screen')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function matchesPathname(url, expectedPathname) {
  if (!expectedPathname) return false;

  try {
    return new URL(url).pathname === expectedPathname;
  } catch (_) {
    return String(url || '').includes(expectedPathname);
  }
}

async function waitForScreenData(page, screen, requestFailures) {
  const postLoadWaitMs = Number.isFinite(screen.postLoadWaitMs) ? screen.postLoadWaitMs : 1200;

  if (!screen.awaitApiPath) {
    if (postLoadWaitMs > 0) {
      await page.waitForTimeout(postLoadWaitMs);
    }
    return null;
  }

  try {
    await page.waitForResponse(
      (response) => matchesPathname(response.url(), screen.awaitApiPath),
      { timeout: screen.awaitApiTimeoutMs || 20000 }
    );

    if (postLoadWaitMs > 0) {
      await page.waitForTimeout(postLoadWaitMs);
    }

    return null;
  } catch (error) {
    const requestFailure = requestFailures.find((entry) => matchesPathname(entry.url, screen.awaitApiPath));
    if (requestFailure) {
      return `${requestFailure.method} ${screen.awaitApiPath} falhou: ${requestFailure.errorText || error.message}`;
    }
    return `Timeout aguardando resposta de ${screen.awaitApiPath}`;
  }
}

function authOptionsForProfile(profile) {
  if (profile === 'super_admin') {
    return {
      loginStrategy: 'ui',
      username: process.env.TEST_SUPERADMIN_USERNAME || process.env.TEST_ADMIN_USERNAME || 'systemadmin',
      password: process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'Admin123!',
      tenantId: process.env.TEST_TENANT_ID || 'system',
      apiBaseUrl: API_URL,
    };
  }

  if (profile === 'admin') {
    return {
      loginStrategy: 'rpa_then_ui',
      username: process.env.TEST_ADMIN_USERNAME || 'systemadmin',
      password: process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'Admin123!',
      tenantId: process.env.TEST_TENANT_ID || 'system',
      apiBaseUrl: API_URL,
    };
  }

  return {
    tenantId: process.env.TEST_TENANT_ID || 'system',
    apiBaseUrl: API_URL,
  };
}

async function buildStorageState(browser, profile) {
  if (profile === 'public') return null;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const authResult = await autoLoginBeforeSteps(page, {
    firstStep: { type: 'navigate', url: `${FRONTEND_URL}/support` },
    frontendBaseUrl: FRONTEND_URL,
    autoLogin: true,
    authOptions: authOptionsForProfile(profile),
  });

  if (!authResult.success || !authResult.loggedIn) {
    await context.close().catch(() => null);
    throw new Error(`Falha ao autenticar perfil ${profile}: ${authResult.error || 'login não concluído'}`);
  }

  const storageState = await context.storageState();
  await context.close().catch(() => null);
  return storageState;
}

async function runScreen(browser, storageStates, screen) {
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrors = [];
  const requestFailures = [];
  const targetUrl = `${FRONTEND_URL}${screen.path}`;
  const storageState = storageStates[screen.auth] || undefined;

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack || null,
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    requestFailures.push({
      method: request.method(),
      url: request.url(),
      errorText: request.failure()?.errorText || null,
    });
  });
  page.on('response', async (response) => {
    try {
      const status = response.status();
      if (status < 400) return;

      const request = response.request();
      const method = request.method();
      const url = response.url();
      const headers = response.headers();
      const contentType = headers['content-type'] || headers['Content-Type'] || null;
      let bodyPreview = null;

      if (contentType && /application\/json|text\/|application\/problem\+json/i.test(contentType)) {
        try {
          bodyPreview = (await response.text()).slice(0, 500);
        } catch (_) {
          bodyPreview = null;
        }
      }

      httpErrors.push({
        status,
        method,
        url,
        contentType,
        bodyPreview,
      });
    } catch (_) {
      // ignora erro na coleta para nao mascarar o teste principal
    }
  });

  let screenshotPath = null;

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const awaitedApiFailure = await waitForScreenData(page, screen, requestFailures);

    const finalUrl = page.url();
    const title = await page.title().catch(() => null);
    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    const expectedPath = screen.expectedPath || screen.path;
    const expectedTexts = Array.isArray(screen.expectedText)
      ? screen.expectedText.filter(Boolean)
      : (screen.expectedText ? [screen.expectedText] : []);
    const ignoredConsoleErrorPatterns = (screen.ignoredConsoleErrorPatterns || []).map((pattern) => new RegExp(pattern, 'i'));
    const ignoredHttpErrorPatterns = (screen.ignoredHttpErrorPatterns || []).map((pattern) => new RegExp(pattern, 'i'));

    const failures = [];

    if (!finalUrl.includes(expectedPath)) {
      failures.push(`URL final inesperada: ${finalUrl}`);
    }

    if (screen.auth !== 'public' && (finalUrl.includes('/login') || /input\[name="username"\]|Entrar|Login/.test(bodyText))) {
      failures.push('Tela autenticada voltou para login');
    }

    if (bodyText.includes('Acesso Negado')) {
      failures.push('Tela retornou Acesso Negado');
    }

    for (const expectedText of expectedTexts) {
      if (!bodyText.includes(expectedText)) {
        failures.push(`Texto esperado ausente: ${expectedText}`);
      }
    }

    if (pageErrors.length > 0) {
      failures.push(`${pageErrors.length} pageerror(s) no browser`);
    }

    const relevantConsoleErrors = consoleErrors.filter((entry) => {
      const text = String(entry || '');
      return !ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text));
    });

    if (screen.failOnConsoleError !== false && relevantConsoleErrors.length > 0) {
      failures.push(`${relevantConsoleErrors.length} console.error(s) no browser`);
    }

    const relevantHttpErrors = httpErrors.filter((entry) => {
      const text = `${entry.method || 'GET'} ${entry.url || ''} ${entry.status || ''} ${entry.bodyPreview || ''}`;
      return !ignoredHttpErrorPatterns.some((pattern) => pattern.test(text));
    });

    if (screen.failOnHttpError !== false && relevantHttpErrors.length > 0) {
      failures.push(`${relevantHttpErrors.length} HTTP error(s) >= 400`);
    }

    if (awaitedApiFailure) {
      failures.push(awaitedApiFailure);
    }

    if (failures.length > 0) {
      ensureDir(SCREENSHOTS_DIR);
      screenshotPath = path.join(SCREENSHOTS_DIR, `${slugify(screen.id)}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
    }

    return {
      id: screen.id,
      path: screen.path,
      auth: screen.auth,
      category: screen.category,
      success: failures.length === 0,
      failures,
      finalUrl,
      title,
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 10),
      httpErrors: httpErrors.slice(0, 10),
      screenshotPath,
    };
  } catch (error) {
    ensureDir(SCREENSHOTS_DIR);
    screenshotPath = path.join(SCREENSHOTS_DIR, `${slugify(screen.id)}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

    return {
      id: screen.id,
      path: screen.path,
      auth: screen.auth,
      category: screen.category,
      success: false,
      failures: [error.message],
      finalUrl: page.url(),
      title: await page.title().catch(() => null),
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 10),
      httpErrors: httpErrors.slice(0, 10),
      screenshotPath,
    };
  } finally {
    await context.close().catch(() => null);
  }
}

function writeReport(report) {
  ensureDir(REPORTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORTS_DIR, `screen-catalog-${stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `screen-catalog-${stamp}.md`);
  const latestMdPath = path.join(REPORTS_DIR, 'screen-catalog-latest.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('# RPA Screen Catalog');
  lines.push('');
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Frontend: ${report.frontendUrl}`);
  lines.push(`- API: ${report.apiUrl}`);
  lines.push(`- Total de telas: ${report.summary.total}`);
  lines.push(`- Sucesso: ${report.summary.passed}`);
  lines.push(`- Falhas: ${report.summary.failed}`);
  lines.push('');
  lines.push('## Resultado por Tela');
  for (const result of report.results) {
    lines.push(`- ${result.id} \`${result.path}\` [${result.auth}]: ${result.success ? 'PASS' : 'FAIL'}`);
    if (!result.success) {
      lines.push(`  Falhas: ${result.failures.join(' | ')}`);
      if (result.consoleErrors?.length) {
        lines.push(`  Console: ${result.consoleErrors.join(' | ')}`);
      }
      if (result.httpErrors?.length) {
        lines.push(`  HTTP: ${result.httpErrors.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).join(' | ')}`);
      }
    }
  }

  if (report.failures.length > 0) {
    lines.push('');
    lines.push('## Falhas');
    for (const failure of report.failures) {
      lines.push(`- ${failure.id} \`${failure.path}\`: ${failure.failures.join(' | ')}`);
      if (failure.consoleErrors?.length) {
        lines.push(`  Console: ${failure.consoleErrors.join(' | ')}`);
      }
      if (failure.httpErrors?.length) {
        lines.push(`  HTTP: ${failure.httpErrors.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).join(' | ')}`);
      }
      if (failure.screenshotPath) {
        lines.push(`  Screenshot: ${failure.screenshotPath}`);
      }
    }
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  fs.writeFileSync(latestMdPath, `${lines.join('\n')}\n`);

  return { jsonPath, mdPath, latestMdPath };
}

async function runScreenCatalog(argv = process.argv, env = process.env) {
  const selectedIds = parseSelectedScreenIds(argv, env);
  const selectedScreens = getSelectedScreens(SCREEN_CATALOG, selectedIds);

  if (selectedIds.length > 0 && selectedScreens.length === 0) {
    throw new Error(`Nenhuma tela encontrada para os ids: ${selectedIds.join(', ')}`);
  }

  console.log(`📺 RPA Screen Catalog (${selectedScreens.length} telas)\n`);
  const launch = await launchChromiumWithFallback(chromium, { headless: process.env.HEADLESS !== 'false' });
  const browser = launch.browser;

  try {
    const storageStates = {
      public: null,
      admin: await buildStorageState(browser, 'admin'),
      super_admin: await buildStorageState(browser, 'super_admin'),
    };

    const results = [];
    for (const screen of selectedScreens) {
      console.log(`- ${screen.id} -> ${screen.path} [${screen.auth}]`);
      // eslint-disable-next-line no-await-in-loop
      const result = await runScreen(browser, storageStates, screen);
      console.log(`  ${result.success ? 'PASS' : 'FAIL'}${result.failures.length ? `: ${result.failures.join(' | ')}` : ''}`);
      results.push(result);
    }

    const failures = results.filter((item) => !item.success);
    const report = {
      generatedAt: new Date().toISOString(),
      frontendUrl: FRONTEND_URL,
      apiUrl: API_URL,
      browserSource: launch.browserSource,
      browserExecutablePath: launch.executablePath,
      summary: {
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
      },
      results,
      failures,
    };
    const paths = writeReport(report);
    console.log('\nResumo');
    console.log(`- PASS: ${report.summary.passed}`);
    console.log(`- FAIL: ${report.summary.failed}`);
    console.log(`- Relatório JSON: ${paths.jsonPath}`);
    console.log(`- Relatório Markdown: ${paths.mdPath}`);
    return { report, paths };
  } finally {
    await browser.close().catch(() => null);
  }
}

if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/runScreenCatalogRPA.js');
  runScreenCatalog()
    .then(({ report }) => {
      process.exit(report.summary.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Falha ao executar screen catalog RPA:', error);
      process.exit(1);
    });
}

module.exports = {
  parseSelectedScreenIds,
  getSelectedScreens,
  runScreenCatalog,
};
