#!/usr/bin/env node
'use strict';

/**
 * page-surface-wave.js — runner da Page Surface Wave (Security/Platform Wave).
 *
 * Executa probes REAIS de navegação (Playwright/Chromium headless) contra o
 * frontend vivo e alimenta o motor puro `qa/coverage/pageSurfaceWave.js`,
 * produzindo `reports/page-surface-report.json` — fonte de execução técnica
 * consumida pelo coverage gate para itens `page:` sem domínio/jornada ligada
 * (scripts/governance/validate-coverage-gate.js).
 *
 * Probes por item (política em qa/coverage/pageSurfaceWave.js):
 *   - P1 anonymous:  contexto novo por probe, sem credencial.
 *   - P2 production: usuário operacional (role admin → PRODUCTION),
 *                    provisionado pelo MESMO fluxo RPA da API Surface Wave
 *                    (/auth/rpa/token + /auth/rpa/login) — tenant 'system'
 *                    (tenant real: o tenant sintético 'api-surface-wave' não
 *                    existe no cadastro e quebrava o bootstrap do frontend
 *                    com 404 em /tenants/:id); sessão injetada no browser via
 *                    localStorage (contexto novo por probe).
 *   - P3 superadmin: super_admin via login real de UI
 *                    (tests/helpers/playwrightAuth.js) uma única vez, com
 *                    storageState reutilizado em contexto novo por probe
 *                    (apenas páginas SUPPORT/DEVELOPMENT).
 *
 * Rotas de página que colidem com o proxy de API do dev server Vite (ex.:
 * /tenants → 401, /admin/agents e /system-status → 404 no documento) são
 * navegadas client-side (pushState + evento router:change do useRouter),
 * como um usuário real que chega pelo menu — o documento 401/404 do proxy é
 * artefato do dev server, não da página.
 *
 * Uso:
 *   node scripts/governance/page-surface-wave.js
 *   PAGE_SURFACE_BASE_URL=http://localhost:5173 node scripts/governance/page-surface-wave.js
 *
 * Credenciais (defaults = credenciais QA locais documentadas em AGENTS.md):
 *   PAGE_SURFACE_ADMIN_USER / PAGE_SURFACE_ADMIN_PASSWORD
 *   PAGE_SURFACE_API_URL (default http://localhost:3001) para os logins de token.
 *
 * O relatório registra apenas sinais de superfície e contadores — nunca
 * tokens, credenciais ou corpos de resposta. Amostras de erro de console são
 * sanitizadas (JWT/Bearer removidos) e truncadas.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { chromium } = require('playwright');

const { evaluatePageSurface, probePolicy, classifyPageConsoleError } = require('../../qa/coverage/pageSurfaceWave');
const { loginWithTenantSelection } = require('../../tests/helpers/playwrightAuth');

const ROOT_DIR = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');
const EXEMPTIONS_PATH = path.join(ROOT_DIR, 'config', 'page-surface-exemptions.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'page-surface-report.json');

const BASE_URL = (process.env.PAGE_SURFACE_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const API_URL = (process.env.PAGE_SURFACE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const ADMIN_USER = process.env.PAGE_SURFACE_ADMIN_USER || 'systemadmin';
const ADMIN_PASSWORD = process.env.PAGE_SURFACE_ADMIN_PASSWORD || 'Admin123!';
const NAV_TIMEOUT_MS = Number(process.env.PAGE_SURFACE_NAV_TIMEOUT_MS || 15000);
const SURFACE_TIMEOUT_MS = Number(process.env.PAGE_SURFACE_SURFACE_TIMEOUT_MS || 10000);
const SETTLE_MS = Number(process.env.PAGE_SURFACE_SETTLE_MS || 800);
const CONCURRENCY = Number(process.env.PAGE_SURFACE_CONCURRENCY || 4);

/** Remove segredos de amostras de erro antes de gravar em relatório. */
function sanitizeSample(text) {
  return String(text || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt-redacted]')
    .replace(/(password|senha|token|secret)["'\s:=]+\S+/gi, '$1=[redacted]')
    .slice(0, 200);
}

/**
 * Navega até uma página. Quando o documento direto falha (rota de página que
 * colide com o proxy de API do dev server → 401/404, ou erro de navegação),
 * cai para navegação client-side: carrega o shell em /login e aplica
 * pushState + evento router:change (mesmo mecanismo do useRouter da app).
 */
async function navigateToPage(page, pagePath) {
  let docStatus = 0;
  try {
    const response = await page.goto(`${BASE_URL}${pagePath}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    docStatus = response ? response.status() : 0;
  } catch {
    docStatus = 0;
  }
  if (docStatus > 0 && docStatus < 400) {
    return { docStatus, viaSpa: false };
  }
  try {
    const shell = await page.goto(`${BASE_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await page.evaluate((target) => {
      window.history.pushState({}, '', target);
      window.dispatchEvent(new CustomEvent('router:change'));
    }, pagePath);
    return { docStatus: shell ? shell.status() : 200, viaSpa: true };
  } catch {
    return { error: true };
  }
}

/**
 * Sonda uma página num contexto: navega, classifica a superfície resultante
 * (login / acesso negado / conteúdo) e conta erros de console e de página.
 * Retorna sinais para o motor puro — nunca HTML nem payload.
 */
async function probePage(context, pagePath) {
  const page = await context.newPage();
  let consoleErrors = 0;
  let pageErrors = 0;
  let expectedEmptyErrors = 0;
  const errorSamples = [];
  const failedResources = [];
  const sample = (text) => {
    if (errorSamples.length < 3) errorSamples.push(sanitizeSample(text));
  };
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failedResources.push({ url: response.url(), status });
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // 404 de estado vazio (contrato da API) gera "Failed to load resource"
      // emitido pelo browser — não é quebra da página. A allowlist auditável
      // vive em qa/coverage/pageSurfaceWave.js; o restante conta como erro.
      const classification = classifyPageConsoleError({
        text: msg.text(),
        url: msg.location() && msg.location().url,
        failedResources,
      });
      if (classification === 'expected-empty') {
        expectedEmptyErrors += 1;
        return;
      }
      consoleErrors += 1;
      sample(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors += 1;
    sample(err && err.message ? err.message : err);
  });

  const nav = await navigateToPage(page, pagePath);
  if (nav.error) {
    await page.close().catch(() => {});
    return { error: true };
  }
  const { docStatus, viaSpa } = nav;

  // Aguarda a superfície estabilizar: login, acesso negado ou conteúdo real.
  // loginSurface exige campo de senha E (campo username ou título "Login de
  // Agente") — formulários públicos com senha (ex.: /saas/signup) NÃO são a
  // superfície de login.
  const started = Date.now();
  let loginSurface = false;
  let denied = false;
  let rendered = false;
  while (Date.now() - started < SURFACE_TIMEOUT_MS) {
    const surface = await page.evaluate(() => {
      const body = document.body;
      const text = String((body && body.innerText) || '');
      const passwordField = Boolean(document.querySelector('input[type="password"]'));
      const usernameField = Boolean(document.querySelector('input[name="username"]'));
      const loginTitle = text.includes('Login de Agente');
      const deniedText = text.includes('Acesso Negado');
      const root = document.getElementById('root');
      const hasContent = Boolean(root && String(root.innerText || '').trim().length > 40);
      const onlyLoading = /^carregando[.\s]*$/i.test(text.trim());
      return { passwordField, usernameField, loginTitle, deniedText, hasContent, onlyLoading };
    }).catch(() => null);
    if (!surface) break; // navegação em curso/destruída — tenta de novo
    if (surface.passwordField && (surface.usernameField || surface.loginTitle)) { loginSurface = true; break; }
    if (surface.deniedText) { denied = true; break; }
    if (surface.hasContent && !surface.onlyLoading) { rendered = true; break; }
    await page.waitForTimeout(300);
  }

  // Janela curta para erros de console assíncronos pós-render.
  await page.waitForTimeout(SETTLE_MS).catch(() => {});

  // Re-checa superfície final (redirect tardio para login, etc.)
  if (rendered) {
    const finalSurface = await page.evaluate(() => {
      const text = String((document.body && document.body.innerText) || '');
      return {
        loginSurface: Boolean(document.querySelector('input[type="password"]'))
          && (Boolean(document.querySelector('input[name="username"]')) || text.includes('Login de Agente')),
        deniedText: text.includes('Acesso Negado'),
      };
    }).catch(() => null);
    if (finalSurface && (finalSurface.loginSurface || finalSurface.deniedText)) {
      rendered = false;
      loginSurface = finalSurface.loginSurface;
      denied = finalSurface.deniedText;
    }
  }

  await page.close().catch(() => {});
  return { loginSurface, denied, rendered, docStatus, viaSpa, consoleErrors, pageErrors, expectedEmptyErrors, errorSamples };
}

/** Token de API do super_admin (classificação DEVELOPMENT) para leituras SUPPORT+. */
async function loginAdminApiToken() {
  try {
    const res = await fetch(`${API_URL}/auth/login?tenantId=system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const body = await res.json();
    return body && typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

/** Sessão de papel operacional (PRODUCTION): mesmo fluxo RPA da API Surface Wave. */
async function loginProductionRole(bearerToken) {
  try {
    // Desde 2026-08-03 GET /auth/rpa/token exige sessão SUPPORT+ (o token RPA
    // é segredo de serviço): o runner apresenta o Bearer do super_admin.
    if (!bearerToken) return null;
    const tokenRes = await fetch(`${API_URL}/auth/rpa/token`, {
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
    });
    if (tokenRes.status !== 200) return null;
    const { token: rpaToken } = await tokenRes.json();
    const loginRes = await fetch(`${API_URL}/auth/rpa/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Tenant 'system' (real): o tenant sintético 'api-surface-wave' não é
      // cadastrado e o bootstrap do frontend 404ava em GET /tenants/:id.
      // A classificação PRODUCTION vem do role admin, não do tenant.
      body: JSON.stringify({ token: rpaToken, tenantId: 'system' }),
      signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
    });
    if (loginRes.status !== 200) return null;
    const body = await loginRes.json();
    if (!body || typeof body.token !== 'string' || !body.agent) return null;
    return { token: body.token, agent: body.agent };
  } catch {
    return null;
  }
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  let exemptions = {};
  try {
    exemptions = JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, 'utf8'));
  } catch {
    exemptions = {};
  }
  const pageItems = (inventory.items || []).filter((item) => item && item.kind === 'page');
  console.log(`[page-surface-wave] alvo: ${BASE_URL} (api: ${API_URL})`);
  console.log(`[page-surface-wave] ${pageItems.length} páginas page: no inventário`);

  let prodSession = await loginProductionRole(await loginAdminApiToken());
  console.log(`[page-surface-wave] sessão production=${prodSession ? 'ok' : 'indisponível'}`);
  if (!prodSession) {
    console.log('[page-surface-wave] AVISO: sem sessão de papel operacional — P2 pulado (itens ficam no máximo VISITED/BLOCKED)');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    // Fábrica de contextos P2 (produção): sessão RPA injetada via localStorage
    // antes dos scripts da app. Contexto NOVO por probe — uma página que limpa
    // a sessão (logout por 401, guard de websocket) não contamina as demais.
    let newProdContext = null;
    if (prodSession) {
      newProdContext = async () => {
        const context = await browser.newContext();
        await context.addInitScript((session) => {
          try {
            window.localStorage.setItem('auth_token', session.token);
            window.localStorage.setItem('auth_agent', JSON.stringify(session.agent));
            if (session.agent && session.agent.tenantId) {
              window.localStorage.setItem('auth_effective_tenant_id', String(session.agent.tenantId));
            }
          } catch {
            // localStorage indisponível — probes P2 reportarão loginSurface
          }
        }, prodSession);
        return context;
      };
    }

    // Sessão P3 (super_admin): login real de UI; o storageState é reutilizado
    // em contexto NOVO por probe (mesmo motivo do P2). Se uma página derrubar
    // a sessão (guard de websocket → logout revoga o token), o runner refaz o
    // login e tenta de novo (ver probeP3).
    let adminStorageState = null;
    async function loginAdminUi() {
      const loginContext = await browser.newContext();
      const loginPage = await loginContext.newPage();
      try {
        await loginWithTenantSelection(loginPage, {
          targetUrl: `${BASE_URL}/login`,
          username: ADMIN_USER,
          password: ADMIN_PASSWORD,
          tenantId: 'system',
        });
        const authed = await loginPage.evaluate(() => Boolean(window.localStorage.getItem('auth_token')));
        if (!authed) return null;
        const state = await loginContext.storageState();
        return state;
      } finally {
        await loginContext.close().catch(() => {});
      }
    }
    const needsAdmin = pageItems.some((item) => probePolicy(item).p3);
    if (needsAdmin) {
      try {
        adminStorageState = await loginAdminUi();
        if (adminStorageState) {
          console.log('[page-surface-wave] sessão development=ok (login UI super_admin)');
        } else {
          console.log('[page-surface-wave] AVISO: login super_admin sem token — P3 pulado (itens privilegiados ficam no máximo VISITED)');
        }
      } catch (err) {
        console.log(`[page-surface-wave] AVISO: login super_admin falhou (${err && err.message ? err.message : err}) — P3 pulado`);
      }
    }

    async function probeInContext(newContext, pagePath) {
      const context = await newContext();
      try {
        return await probePage(context, pagePath);
      } finally {
        await context.close().catch(() => {});
      }
    }

    // P2 com self-healing: se a sessão caiu (loginSurface), renova o token RPA
    // e tenta uma segunda vez.
    async function probeP2(pagePath) {
      if (!newProdContext) return null;
      const first = await probeInContext(newProdContext, pagePath);
      if (!first || first.error || !first.loginSurface) return first;
      const refreshed = await loginProductionRole(await loginAdminApiToken());
      if (!refreshed) return first;
      prodSession = refreshed;
      return probeInContext(newProdContext, pagePath);
    }

    // P3 SERIALIZADO (sem concorrência): múltiplas páginas simultâneas com o
    // mesmo token derrubam a sessão (websocket auth/logout em cascata). Com
    // self-healing: loginSurface → refaz o login UI e tenta uma segunda vez.
    async function probeP3(pagePath) {
      if (!adminStorageState) return null;
      const newAdminContext = () => browser.newContext({ storageState: adminStorageState });
      const first = await probeInContext(newAdminContext, pagePath);
      if (!first || first.error || !first.loginSurface) return first;
      const refreshed = await loginAdminUi().catch(() => null);
      if (!refreshed) return first;
      adminStorageState = refreshed;
      return probeInContext(newAdminContext, pagePath);
    }

    const probesByItemId = new Map();
    const p3Items = [];
    let done = 0;

    async function probeItem(item) {
      const policy = probePolicy(item);
      const probes = {};

      // P1: contexto anônimo novo por probe.
      if (policy.p1) {
        const anonContext = await browser.newContext();
        try {
          probes.p1 = await probePage(anonContext, item.path);
        } finally {
          await anonContext.close().catch(() => {});
        }
      }
      if (policy.p2 && newProdContext) {
        probes.p2 = await probeP2(item.path);
      }
      if (policy.p3) {
        p3Items.push(item); // P3 roda serializado após o pool
      }

      probesByItemId.set(item.id, probes);
      done += 1;
      if (done % 25 === 0) console.log(`[page-surface-wave] progresso: ${done}/${pageItems.length}`);
    }

    // pool de concorrência simples
    const queue = [...pageItems];
    const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await probeItem(item);
      }
    });
    await Promise.all(workers);

    // Passada P3 (páginas SUPPORT/DEVELOPMENT), serializada.
    let p3done = 0;
    for (const item of p3Items) {
      const probes = probesByItemId.get(item.id) || {};
      probes.p3 = await probeP3(item.path);
      probesByItemId.set(item.id, probes);
      p3done += 1;
      if (p3done % 10 === 0) console.log(`[page-surface-wave] progresso P3: ${p3done}/${p3Items.length}`);
    }

    const { perItem, totals, exemptionsApplied } = evaluatePageSurface(inventory.items, probesByItemId, exemptions);

    let commit = null;
    try {
      commit = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = null;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      commit,
      baseUrl: BASE_URL,
      sessions: { development: Boolean(adminStorageState), production: Boolean(newProdContext) },
      totals,
      status: (totals.byState?.FAILED || 0) === 0 && (totals.byState?.BLOCKED || 0) === 0 ? 'PASS' : 'FAIL',
      exemptions: exemptionsApplied,
      perItem,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    const byState = totals.byState || {};
    console.log(`[page-surface-wave] estados: VALIDATED=${byState.VALIDATED || 0} VISITED=${byState.VISITED || 0} `
      + `FAILED=${byState.FAILED || 0} BLOCKED=${byState.BLOCKED || 0}`);
    // Mesmo padrão do db-integrity-wave: listar os FAILED no log — em CI o
    // relatório fica no runner e o log é a única evidência acessível.
    for (const entry of (perItem || [])) {
      if (entry && entry.state === 'FAILED') {
        const failedAssertions = (entry.assertions || [])
          .filter((a) => a && a.passed === false && !a.notEvaluated)
          .map((a) => a.name);
        console.log(`[page-surface-wave] FAILED ${entry.id}: ${failedAssertions.join(', ') || 'sem assertiva identificada'}`);
        // Sinais dos probes (erros de console/página) — em CI o log é a
        // única evidência acessível; samples já passam por sanitizeSample.
        for (const [probeName, probe] of Object.entries(entry.probes || {})) {
          if (probe && typeof probe === 'object' && !probe.error) {
            const samples = Array.isArray(probe.errorSamples) && probe.errorSamples.length > 0
              ? ` | samples: ${probe.errorSamples.join(' || ')}`
              : '';
            console.log(`[page-surface-wave]   ${probeName}: rendered=${probe.rendered} login=${probe.loginSurface} denied=${probe.denied} docStatus=${probe.docStatus} consoleErrors=${probe.consoleErrors} pageErrors=${probe.pageErrors} expectedEmpty=${probe.expectedEmptyErrors || 0}${samples}`);
          } else if (probe && probe.error) {
            console.log(`[page-surface-wave]   ${probeName}: erro de navegação/rede`);
          }
        }
      }
    }
    console.log(`[page-surface-wave] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
    if ((byState.FAILED || 0) > 0) {
      console.log('[page-surface-wave] ATENÇÃO: há itens FAILED — inspecione o relatório (possível falha de segurança ou drift de inventário)');
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[page-surface-wave] falha fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
