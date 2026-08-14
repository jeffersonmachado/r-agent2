'use strict';

const { chromium } = require('playwright');
const { loginWithTenantSelection } = require('../../tests/helpers/playwrightAuth');
const {
  failIfNeeded,
  statusFromIssues,
  writeReport,
} = require('./common');

const baseUrl = process.env.RUNTIME_BASE_URL || 'http://127.0.0.1:5173';
const username = process.env.TEST_SUPERADMIN_USERNAME || process.env.TEST_USERNAME || 'systemadmin';
const password = process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!';
const tenantId = process.env.TEST_TENANT_ID || 'system';

const routes = [
  { requested: '/support', canonical: '/support' },
  { requested: '/dev/system-status', canonical: '/dev/system-status' },
  { requested: '/dev/rpa-replays', canonical: '/dev/rpa-replays' },
  { requested: '/rag-documents', canonical: '/rag-documents' },
  { requested: '/whatsapp-connections', canonical: '/whatsapp-connections' },
  { requested: '/channel-health', canonical: '/channel-health' },
  { requested: '/generate-system', canonical: '/generate-system' },
];

function buildUrl(route) {
  return new URL(route, baseUrl).toString();
}

async function main() {
  const issues = [];
  const observations = [];
  const startedAt = new Date().toISOString();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    const networkFailures = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text().slice(0, 500);
        // Ruido conhecido em navegacao de runtime: fetch de /auth/me pode abortar sem impacto funcional.
        if (/Failed to fetch/i.test(text) && /\/auth\/me/i.test(text)) {
          return;
        }
        // ChannelHealthPage dispara GET /system/channel-health no mount; ao
        // navegar para a rota seguinte o browser aborta o fetch em voo
        // (ERR_ABORTED) e a página loga "Failed to fetch" + toast — ruído de
        // navegação, não falha funcional da rota alvo.
        if (/Failed to fetch/i.test(text) && /\/system\/channel-health/i.test(text)) {
          return;
        }
        if (/\[ChannelHealth\] Erro ao buscar health/i.test(text)) {
          return;
        }
        if (/API não acessível/i.test(text) && /\/system\/channel-health/i.test(text)) {
          return;
        }
        consoleErrors.push({ text, location: message.location() });
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure() ? request.failure().errorText : 'unknown';
      const url = request.url();
      // /auth/me pode ser abortado em troca de rota sem indicar falha funcional.
      if (url.includes('/auth/me') && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // Telemetria do Learning Core: o browser aborta a leitura da resposta em
      // navegação, mas o ingest é entregue (sendBeacon/keepalive) — mesmo caso
      // de /auth/me: ruído de navegação, não falha funcional.
      if (url.includes('/api/learning/interactions') && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // ChannelHealthPage: fetch de /system/channel-health abortado na troca de
      // rota (mesma classe de ruído de /auth/me).
      if (url.includes('/system/channel-health') && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // Chunks lazy de páginas (code splitting, main.jsx): o validador navega
      // com page.goto (reload completo), que aborta imports dinâmicos em voo da
      // rota anterior — ruído de navegação, não falha funcional.
      if (/ERR_ABORTED/i.test(failure) && /\/src\/pages\/.+\.jsx/.test(url)) {
        return;
      }
      networkFailures.push({
        url,
        method: request.method(),
        failure,
      });
    });

    const login = await loginWithTenantSelection(page, {
      targetUrl: buildUrl('/workspace'),
      username,
      password,
      tenantId,
    });

    // O login redireciona para o workspace, que carrega /config em paralelo.
    // Se a primeira rota for aberta imediatamente, o Chromium aborta esse
    // request válido e o atribui incorretamente à rota /support. Aguarde o
    // pós-login estabilizar antes de zerar os contadores por rota.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(250);

    const authState = await page.evaluate(() => ({
      hasToken: Boolean(localStorage.getItem('auth_token')),
      effectiveTenant: localStorage.getItem('auth_effective_tenant_id'),
      agent: localStorage.getItem('auth_agent'),
    }));

    if (!authState.hasToken) {
      issues.push({ code: 'runtime_auth_missing', message: 'Browser login did not produce auth_token.' });
    }

    for (const route of routes) {
      const beforeErrors = consoleErrors.length;
      const beforeFailures = networkFailures.length;
      const response = await page.goto(buildUrl(route.requested), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
        issues.push({ code: 'route_navigation_error', route: route.requested, message: error.message });
        return null;
      });
      await page.waitForTimeout(1200);
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => null);

      const snapshot = await page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => String(node.textContent || '').trim()).filter(Boolean)[0] || '';
        const text = String(document.body ? document.body.innerText : '').slice(0, 2000);
        const links = Array.from(document.querySelectorAll('a[href],button')).slice(0, 80).map((node) => String(node.textContent || node.getAttribute('aria-label') || '').trim()).filter(Boolean);
        return { heading, textLength: text.length, textSample: text, controls: links };
      }).catch(() => ({ heading: '', textLength: 0, textSample: '', controls: [] }));

      const finalPath = new URL(page.url()).pathname;
      const status = response ? response.status() : 0;
      const routeErrors = consoleErrors.slice(beforeErrors);
      const routeFailures = networkFailures.slice(beforeFailures);
      const isJsonError = snapshot.textSample.trim().startsWith('{') && /error|unauthorized|not_found/i.test(snapshot.textSample);
      const rendered = snapshot.textLength > 50 && !isJsonError && status < 500;
      const canonicalReached = finalPath === route.canonical || route.requested === route.canonical;

      const result = {
        requested: route.requested,
        canonical: route.canonical,
        finalPath,
        httpStatus: status,
        rendered,
        canonicalReached,
        heading: snapshot.heading,
        consoleErrors: routeErrors,
        networkFailures: routeFailures,
      };
      observations.push(result);

      if (!rendered) {
        issues.push({ code: 'route_not_rendered', route: route.requested, message: `${route.requested} did not render an authenticated page.` });
      }
      if (route.requested === route.canonical && finalPath !== route.canonical) {
        issues.push({ code: 'route_redirected_unexpectedly', route: route.requested, finalPath, message: `${route.requested} ended at ${finalPath}.` });
      }
      if (routeErrors.length > 0) {
        issues.push({ code: 'route_console_errors', route: route.requested, count: routeErrors.length, message: `${route.requested} emitted console errors.` });
      }
      if (routeFailures.length > 0) {
        issues.push({ code: 'route_network_failures', route: route.requested, count: routeFailures.length, message: `${route.requested} had failed network requests.` });
      }
    }

    const report = {
      name: 'validate-runtime-routes',
      status: statusFromIssues(issues),
      startedAt,
      baseUrl,
      login,
      authState: { hasToken: authState.hasToken, effectiveTenant: authState.effectiveTenant },
      observations,
      issues,
      suggestions: issues.map((issue) => issue.message),
    };
    writeReport('runtime-routes-validation-report.json', report);
    failIfNeeded(report);
  } catch (error) {
    const report = {
      name: 'validate-runtime-routes',
      status: 'FAIL',
      startedAt,
      baseUrl,
      observations,
      issues: [{ code: 'runtime_validation_error', message: error.message }],
      suggestions: ['Start the real frontend/API stack and rerun runtime validation.'],
    };
    writeReport('runtime-routes-validation-report.json', report);
    failIfNeeded(report);
  } finally {
    if (browser) await browser.close();
  }
}

main();
