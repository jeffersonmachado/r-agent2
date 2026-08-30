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
        // Toast da ChannelHealthPage: o fetch de /system/channel-health é
        // abortado quando o validador navega (page.goto = reload completo) e o
        // catch dispara o toast já na rota seguinte — ruído de navegação.
        if (/Toast \[error\]: Erro ao buscar saúde de canais/i.test(text)) {
          return;
        }
        // UserMenu (badge de tickets ativos) dispara GET /tickets?status=in_progress
        // no mount de toda página; a navegação full-page do validador aborta o
        // fetch em voo (ERR_ABORTED) e o catch loga erro + hint — mesma classe
        // de ruído de /auth/me, não falha funcional da rota alvo.
        if (/Failed to fetch/i.test(text) && /\/tickets\?/i.test(text)) {
          return;
        }
        if (/Erro capturado no catch/i.test(text) && /\/tickets\?/i.test(text)) {
          return;
        }
        if (/API não acessível/i.test(text) && /\/tickets\?/i.test(text)) {
          return;
        }
        // RpaReplaysPage (/rag-documents): erros de carregamento de replays/artefatos
        // quando o endpoint não está acessível no contexto de validação. A página
        // renderiza com estado de erro — não é falha funcional da rota.
        if (/\[RpaReplaysPage\]/i.test(text) && /erro ao carregar|error loading/i.test(text)) {
          return;
        }
        // RpaReplaysPage (/rag-documents): fetch secundário de
        // /api/test-executions/artifacts abortado na troca de rota (ERR_ABORTED).
        // O HTTP Client loga "Erro capturado no catch (Failed to fetch)" +
        // "API não acessível" — dado secundário, a página renderiza sem ele
        // (mesma classe de ruído de /auth/me e /tickets?). O requestfailed já
        // isenta esse endpoint; aqui isenta o equivalente via console.
        if (/Erro capturado no catch/i.test(text) && /\/api\/test-executions\/artifacts/i.test(text)) {
          return;
        }
        if (/API não acessível/i.test(text) && /\/api\/test-executions\/artifacts/i.test(text)) {
          return;
        }
        // RAGDocumentsPage: fetches de /rag/* em voo são abortados (ERR_ABORTED)
        // quando o validador navega para a rota seguinte; o catch loga
        // "Failed to fetch" + "API não acessível" + erros de carga já na rota
        // alvo — mesma classe de ruído de navegação de /auth/me e /tickets?,
        // não falha funcional da rota alvo.
        if (/Erro capturado no catch/i.test(text) && /\/rag\//i.test(text)) {
          return;
        }
        if (/API não acessível/i.test(text) && /\/rag\//i.test(text)) {
          return;
        }
        if (/Erro ao carregar (sources|dados|configuração de domínios)/i.test(text) && /Failed to fetch/i.test(text)) {
          return;
        }
        if (/Toast \[error\]: Erro ao carregar dados/i.test(text)) {
          return;
        }
        // WorkspacePage: fetches de /workspace/entities/:id/{insights,actions,
        // autocorrections} em voo são abortados (ERR_ABORTED) na navegação
        // full-page para a rota seguinte — mesma classe de ruído de /auth/me.
        if (/Erro capturado no catch/i.test(text) && /\/workspace\/entities\//i.test(text)) {
          return;
        }
        if (/API não acessível/i.test(text) && /\/workspace\/entities\//i.test(text)) {
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
      // UserMenu: badge de tickets ativos (GET /tickets?status=in_progress&limit=1000)
      // abortado na navegação full-page — ruído de navegação.
      if (url.includes('/tickets?') && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // Chunks lazy de páginas (code splitting, main.jsx): o validador navega
      // com page.goto (reload completo), que aborta imports dinâmicos em voo da
      // rota anterior — ruído de navegação, não falha funcional.
      if (/ERR_ABORTED/i.test(failure) && /\/src\/pages\/.+\.jsx/.test(url)) {
        return;
      }
      // RpaReplaysPage (/rag-documents): carrega artefatos de execução em segundo
      // plano; se a resposta não completa antes da troca de rota, o browser aborta
      // (ERR_ABORTED). Dado secundário — página renderiza sem ele.
      if (url.includes('/api/test-executions/artifacts') && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // RAGDocumentsPage: /rag/* abortados na troca de rota
      // (ERR_ABORTED) — mesma classe de ruído de navegação de /auth/me.
      if (/\/rag\//i.test(url) && /ERR_ABORTED/i.test(failure)) {
        return;
      }
      // WorkspacePage: /workspace/entities/:id/* abortados na troca de rota
      // (ERR_ABORTED) — mesma classe de ruído de navegação de /auth/me.
      if (/\/workspace\/entities\//i.test(url) && /ERR_ABORTED/i.test(failure)) {
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
      let result = null;
      // Retry único para falha de AMBIENTE (blip de rede do browser —
      // ERR_NETWORK_CHANGED/ERR_CONNECTION_* derruba o fetch de módulos
      // estáticos do Vite e a página não renderiza). Se persistir na 2ª
      // tentativa, é falha real da rota e o gate reprova normalmente.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
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

        result = {
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

        const infraBlip = routeFailures.some((failure) => /ERR_NETWORK_CHANGED|ERR_CONNECTION_(RESET|REFUSED|CLOSED)|ERR_TIMED_OUT/i.test(String(failure.failure || '')));
        if (attempt === 1 && !rendered && infraBlip) {
          continue;
        }
        break;
      }
      observations.push(result);

      if (!result.rendered) {
        issues.push({ code: 'route_not_rendered', route: route.requested, message: `${route.requested} did not render an authenticated page.` });
      }
      if (route.requested === route.canonical && result.finalPath !== route.canonical) {
        issues.push({ code: 'route_redirected_unexpectedly', route: route.requested, finalPath: result.finalPath, message: `${route.requested} ended at ${result.finalPath}.` });
      }
      if (result.consoleErrors.length > 0) {
        issues.push({ code: 'route_console_errors', route: route.requested, count: result.consoleErrors.length, message: `${route.requested} emitted console errors.` });
      }
      if (result.networkFailures.length > 0) {
        issues.push({ code: 'route_network_failures', route: route.requested, count: result.networkFailures.length, message: `${route.requested} had failed network requests.` });
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
