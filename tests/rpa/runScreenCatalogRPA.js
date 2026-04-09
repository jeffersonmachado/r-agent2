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

  let screenshotPath = null;

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);

    const finalUrl = page.url();
    const title = await page.title().catch(() => null);
    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    const expectedPath = screen.expectedPath || screen.path;

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

    if (pageErrors.length > 0) {
      failures.push(`${pageErrors.length} pageerror(s) no browser`);
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
    }
  }

  if (report.failures.length > 0) {
    lines.push('');
    lines.push('## Falhas');
    for (const failure of report.failures) {
      lines.push(`- ${failure.id} \`${failure.path}\`: ${failure.failures.join(' | ')}`);
      if (failure.screenshotPath) {
        lines.push(`  Screenshot: ${failure.screenshotPath}`);
      }
    }
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  fs.writeFileSync(latestMdPath, `${lines.join('\n')}\n`);

  return { jsonPath, mdPath, latestMdPath };
}

async function runScreenCatalog() {
  console.log(`📺 RPA Screen Catalog (${SCREEN_CATALOG.length} telas)\n`);
  const launch = await launchChromiumWithFallback(chromium, { headless: process.env.HEADLESS !== 'false' });
  const browser = launch.browser;

  try {
    const storageStates = {
      public: null,
      admin: await buildStorageState(browser, 'admin'),
      super_admin: await buildStorageState(browser, 'super_admin'),
    };

    const results = [];
    for (const screen of SCREEN_CATALOG) {
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
  runScreenCatalog,
};
