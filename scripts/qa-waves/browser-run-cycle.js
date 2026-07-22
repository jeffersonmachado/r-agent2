'use strict';

/**
 * Driver browser-real para o ciclo QA Waves (login -> waves -> execução -> replay -> governança).
 * Roda headed (DISPLAY=:1) para acompanhamento humano, captura screenshots por etapa
 * e grava run-report.json com ids, URLs finais, erros de console e falhas de rede.
 *
 * Uso:
 *   node scripts/qa-waves/browser-run-cycle.js            # headed (requer DISPLAY)
 *   HEADLESS=1 node scripts/qa-waves/browser-run-cycle.js # headless
 * Evidências: AI_MEMORY/evidence/qa-waves/browser-run-<ts>/ (screenshots + run-report.json)
 * Playwright: resolvido de node_modules raiz ou frontend-e2e/node_modules.
 */

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (_) {
    return require(path.join(__dirname, '..', '..', 'frontend-e2e', 'node_modules', 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const USERNAME = process.env.QA_USER || 'systemadmin';
const PASSWORD = process.env.QA_PASS || 'Admin123!';
const HEADLESS = process.env.HEADLESS === '1';

const ROOT = '/opt/results/ria/r-agent2';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE_DIR = path.join(ROOT, 'AI_MEMORY', 'evidence', 'qa-waves', `browser-run-${RUN_ID}`);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const consoleErrors = [];
const failedRequests = [];
const report = { runId: RUN_ID, baseUrl: BASE_URL, stages: [], consoleErrors, failedRequests };

function stage(name, data = {}) {
  report.stages.push({ name, at: new Date().toISOString(), ...data });
  console.log(`▶ ${name}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

async function shot(page, name) {
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  console.log(`  📸 ${name}.png`);
  return file;
}

function pickReplayId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const c = payload.replayId || payload.id || payload.filename
    || payload?.compatibility?.replayId || payload?.compatibility?.id
    || payload?.execution?.replayId;
  return typeof c === 'string' ? c.replace(/\.json$/i, '') : '';
}

function pickExecutionId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const c = payload.executionId || payload?.compatibility?.executionId
    || payload?.data?.executionId || payload?.execution?.id || payload?.execution?.executionId;
  return typeof c === 'string' ? c : '';
}

async function ensureTenantSelected(page) {
  const heading = page.getByRole('heading', { name: /Selecione o Tenant/i }).first();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
  const overlay = page.locator('div[tabindex="-1"]').filter({ hasText: 'Selecione o Tenant' }).first();
  const visible = (await heading.isVisible().catch(() => false))
    || (await dialog.isVisible().catch(() => false))
    || (await overlay.isVisible().catch(() => false));
  if (!visible) return false;

  const modalRoot = (await dialog.isVisible().catch(() => false)) ? dialog
    : (await overlay.isVisible().catch(() => false)) ? overlay : page;
  await modalRoot.locator('text=System').first().click({ force: true }).catch(() => {});
  const acessar = modalRoot.getByRole('button', { name: /^Acessar$/i }).first();
  if (await acessar.isVisible().catch(() => false)) {
    await acessar.click({ force: true });
  } else {
    await page.getByRole('button', { name: /^Acessar$/i }).first().click({ force: true }).catch(() => {});
  }
  await heading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  return true;
}

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 300 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500 && !res.url().includes('favicon')) {
      failedRequests.push(`${res.request().method()} ${res.url()} :: HTTP ${res.status()}`);
    }
  });

  // ── 1. Login ──────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-login-page');
  const onLogin = await page.locator('text=Login de Agente').isVisible().catch(() => false);
  if (onLogin) {
    await page.locator('input[placeholder*="username" i]').fill(USERNAME);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
    stage('login', { ok: true });
  } else {
    stage('login', { ok: true, note: 'sessão já autenticada' });
  }

  // ── 2. Tenant ─────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
  await shot(page, '02-tenant-modal');
  const tenantDone = await ensureTenantSelected(page);
  stage('tenant', { modalHandled: tenantDone });

  // ── 3. Página QA Waves (com retentativas — app pode redirecionar pós-tenant) ──
  // NB: QaWavesPage.jsx não usa data-testid; título é h1.qa-waves-title
  let title = '';
  for (let attempt = 1; attempt <= 3 && !title; attempt += 1) {
    await page.goto(`${BASE_URL}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
    await ensureTenantSelected(page);
    const ok = await page.locator('h1.qa-waves-title').waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true).catch(() => false);
    if (ok) {
      title = await page.locator('h1.qa-waves-title').innerText().catch(() => '');
    } else {
      stage('qa-waves-page-retry', { attempt, url: page.url() });
      await shot(page, `03-retry-${attempt}`);
    }
  }
  if (!title) throw new Error(`Página QA Waves não carregou. URL final: ${page.url()}`);

  // ── 3b. Selecionar jornada localmente executável (FITNESS → Leads) ──────
  // O cenário padrão (beauty) mapeia para mesh scenarios requiresOfficialPipeline,
  // que não rodam em contexto local. fitness-matricula-leads é local-runnable.
  // Retry: a árvore de jornadas renderiza assíncrona após o título.
  let leadsClicked = false;
  for (let i = 1; i <= 10 && !leadsClicked; i += 1) {
    leadsClicked = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, [role="treeitem"], li, a, span, div'));
      const target = nodes.find((n) => String(n.textContent || '').trim() === 'Leads');
      if (!target) return false;
      (target.closest('button') || target).click();
      return true;
    });
    if (!leadsClicked) await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1500);
  await shot(page, '03b-journey-leads-selected');
  stage('select-journey', { journey: 'fitness/leads', clicked: leadsClicked });

  // ── 3c. Selecionar explicitamente o cenário fitness-matricula-leads ────
  // selectedScenarioId default = items[0] da lista global (hoje beauty-*);
  // sem este passo o botão "Executar cenário" roda o cenário errado.
  const SCENARIO_ID = 'fitness-matricula-leads';
  const cenariosTab = page.getByRole('button', { name: /^cenários$/i }).first();
  await cenariosTab.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  // Selecionar a jornada Leads na árvore DESTA aba (selectedJourneyId filtra a lista)
  for (let i = 1; i <= 10; i += 1) {
    const ok = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, [role="treeitem"], li, a, span, div'));
      const target = nodes.find((n) => String(n.textContent || '').trim() === 'Leads');
      if (!target) return false;
      (target.closest('button') || target).click();
      return true;
    });
    if (ok) break;
    await page.waitForTimeout(2000);
  }
  const scenarioBtn = page.locator('button', { hasText: `${SCENARIO_ID}@` }).first();
  const scenarioClicked = await scenarioBtn.waitFor({ state: 'visible', timeout: 30000 })
    .then(() => scenarioBtn.click({ force: true, timeout: 10000 }).then(() => true))
    .catch(() => false);
  await page.waitForTimeout(1200);
  await shot(page, '03c-scenario-selected');
  stage('select-scenario', { scenario: SCENARIO_ID, clicked: scenarioClicked });
  await shot(page, '03-qa-waves-page');
  stage('qa-waves-page', { title: title.trim(), url: page.url() });

  // ── 4. Executar cenário ───────────────────────────────────────────────
  const runButton = page.getByRole('button', { name: /Executar cenário/i }).first();
  await runButton.waitFor({ state: 'visible', timeout: 15000 });

  const postPromise = page.waitForResponse((resp) => {
    if (resp.request().method() !== 'POST') return false;
    const url = resp.url();
    return url.includes('/api/test-executions') || url.includes('/api/qa-waves/run')
      || url.includes('/dev/qa-waves/run') || url.includes('/api/qa-waves/executions')
      || url.includes('/dev/qa-waves/executions');
  }, { timeout: 90000 });

  let clicked = false;
  for (let i = 1; i <= 3 && !clicked; i += 1) {
    await ensureTenantSelected(page);
    try {
      await runButton.click({ timeout: 7000 });
      clicked = true;
    } catch (_) {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  if (!clicked) throw new Error('Não consegui clicar em Executar cenário');

  const execResp = await postPromise;
  const execBody = await execResp.json().catch(() => ({}));
  const executionId = pickExecutionId(execBody);
  const replayId = pickReplayId(execBody);
  report.executionId = executionId || null;
  report.replayId = replayId || null;
  await shot(page, '04-execution-started');
  stage('execute-scenario', { httpStatus: execResp.status(), executionId, replayId });
  if (!replayId) throw new Error(`Execução não retornou replayId: ${JSON.stringify(execBody).slice(0, 300)}`);

  // ── 4b. Aguardar conclusão da execução (after snapshot é anexado no fim) ─
  let execFinal = null;
  const execDeadline = Date.now() + 180000;
  while (Date.now() < execDeadline) {
    const st = await page.evaluate(async (id) => {
      try {
        const r = await fetch(`/api/qa-waves/executions/${id}`, { credentials: 'include' });
        if (!r.ok) return null;
        return await r.json();
      } catch (_) { return null; }
    }, executionId);
    const status = st?.status || st?.execution?.status || '';
    if (['success', 'failed', 'completed', 'error'].includes(String(status).toLowerCase())) {
      execFinal = { status, progress: st?.progress ?? st?.execution?.progress ?? null };
      break;
    }
    await page.waitForTimeout(5000);
  }
  stage('execution-finished', execFinal || { status: 'timeout_waiting' });
  await shot(page, '04b-execution-finished');

  // ── 5. Replay na UI ───────────────────────────────────────────────────
  // O filtro source=qa-waves retorna 0 (a listagem não extrai source desses
  // arquivos); buscar pelo replayId (filename base) — data-replay-id = replayId.
  const replaysUrl = `${BASE_URL}/dev/rpa-replays?search=${encodeURIComponent(replayId)}`;
  const replayLocator = `[data-testid="rpa-replay-item"][data-replay-id="${replayId}"]`;
  let replayVisible = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !replayVisible) {
    await page.goto(replaysUrl, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('rpa-replays-page').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const loading = page.getByText('Carregando replays...').first();
    if (await loading.isVisible().catch(() => false)) {
      await loading.waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    }
    replayVisible = (await page.locator(replayLocator).count()) > 0;
    if (!replayVisible) await page.waitForTimeout(4000);
  }
  await shot(page, '05-replay-list');
  stage('replay-list', { replayId, visible: replayVisible });

  const replayItem = page.locator(replayLocator).first();
  if (replayVisible) {
    await replayItem.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '06-replay-detail');
    const sidebarVisible = await page.getByTestId('replay-sidebar').first().isVisible().catch(() => false);
    const stepCount = await page.getByTestId('replay-step').count().catch(() => 0);
    stage('replay-detail', { sidebarVisible, stepCount });
  }

  // ── 6. Governança operacional ─────────────────────────────────────────
  await page.goto(`${BASE_URL}/dev/qa-waves/operational-health`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('qa-waves-operational-health-page').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '07-operational-health');
  stage('operational-health', { url: page.url() });

  await page.goto(`${BASE_URL}/dev/qa-waves/enterprise-governance`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('qa-waves-enterprise-governance-page').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '08-enterprise-governance');
  stage('enterprise-governance', { url: page.url() });

  // ── 7. Relatório ──────────────────────────────────────────────────────
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'run-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n✅ Evidências em ${EVIDENCE_DIR}`);
  console.log(`   consoleErrors=${consoleErrors.length} failedRequests=${failedRequests.length}`);

  if (!HEADLESS) {
    console.log('   (browser fica aberto 15s para inspeção)');
    await page.waitForTimeout(15000);
  }
  await browser.close();
}

main().catch((err) => {
  report.error = String(err && err.message ? err.message : err);
  try { fs.writeFileSync(path.join(EVIDENCE_DIR, 'run-report.json'), JSON.stringify(report, null, 2)); } catch (_) {}
  console.error('❌ Falha:', err.message);
  process.exit(1);
});
