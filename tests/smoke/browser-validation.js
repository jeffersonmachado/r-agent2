'use strict';

/**
 * Smoke test via browser - valida deploy e rotas principais
 * 
 * Uso: node tests/smoke/browser-validation.js
 */
const { chromium } = require('playwright');
const { loginWithTenantSelection } = require('../helpers/playwrightAuth');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT = process.env.TEST_TENANT_ID || 'system';
const EVIDENCE_DIR = path.join(__dirname, '..', '..', 'AI_MEMORY', 'evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const results = {
  startedAt: new Date().toISOString(),
  tests: [],
  passed: 0,
  failed: 0,
};

function record(name, status, detail = '') {
  const entry = { name, status, detail, at: new Date().toISOString() };
  results.tests.push(entry);
  if (status === 'PASS') { results.passed++; console.log(`  ✅ ${name}`); }
  else { results.failed++; console.log(`  ❌ ${name}: ${detail}`); }
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
}

async function run() {
  console.log('='.repeat(60));
  console.log('Browser Smoke Test - Deploy Validation');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(60));
  console.log();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const networkFailures = [];
  page.on('requestfailed', req => networkFailures.push(req.url()));

  try {
    // ================================================================
    // 1. Login (usando helper compartilhado)
    // ================================================================
    console.log('[1] Login via playwrightAuth...');
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE_URL}/workspace`,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT,
    });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    if (currentUrl.includes('/workspace') || currentUrl.includes('/dashboard') || currentUrl.includes('/inbox')) {
      record('Login', 'PASS', `Redirected to ${currentUrl}`);
    } else if (!currentUrl.includes('/login')) {
      record('Login', 'PASS', `Authenticated, at ${currentUrl}`);
    } else {
      record('Login', 'FAIL', `Still at login: ${currentUrl}`);
    }
    await screenshot(page, '01-login');

    // Helper: safe navigation with recovery
    async function safeGoto(url, timeout = 10000) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(1500);
        const bodyText = await page.textContent('body').catch(() => '');
        return { ok: true, bodyText };
      } catch (err) {
        // Recover: go back to workspace
        try { await page.goto(`${BASE_URL}/workspace`, { waitUntil: 'domcontentloaded', timeout: 8000 }); } catch (_) {}
        return { ok: false, error: err.message.split('\n')[0] };
      }
    }

    // ================================================================
    // 2. Workspace
    // ================================================================
    console.log('[2] Workspace...');
    const ws = await safeGoto(`${BASE_URL}/workspace`);
    record('Workspace', ws.ok && ws.bodyText.length > 100 ? 'PASS' : 'FAIL', ws.ok ? `Content: ${ws.bodyText.length} chars` : ws.error);
    if (ws.ok) await screenshot(page, '02-workspace');

    // ================================================================
    // 3. Inbox
    // ================================================================
    console.log('[3] Inbox...');
    const inbox = await safeGoto(`${BASE_URL}/inbox`);
    record('Inbox', inbox.ok && inbox.bodyText.length > 50 ? 'PASS' : 'FAIL', inbox.ok ? `Content: ${inbox.bodyText.length} chars` : inbox.error);
    if (inbox.ok) await screenshot(page, '03-inbox');

    // ================================================================
    // 4. Support
    // ================================================================
    console.log('[4] Support...');
    const support = await safeGoto(`${BASE_URL}/support`);
    record('Support', support.ok && support.bodyText.length > 50 ? 'PASS' : 'FAIL', support.ok ? `Content: ${support.bodyText.length} chars` : support.error);
    if (support.ok) await screenshot(page, '04-support');

    // ================================================================
    // 5. Agent OS (DEVELOPMENT - super_admin)
    // ================================================================
    console.log('[5] Agent OS...');
    const agentOs = await safeGoto(`${BASE_URL}/admin/agents`);
    record('Agent OS Hub', agentOs.ok && agentOs.bodyText.length > 50 ? 'PASS' : 'FAIL', agentOs.ok ? `Content: ${agentOs.bodyText.length} chars` : agentOs.error);
    if (agentOs.ok) await screenshot(page, '05-agent-os');

    // ================================================================
    // 6. QA Waves
    // ================================================================
    console.log('[6] QA Waves...');
    const qaWaves = await safeGoto(`${BASE_URL}/dev/qa-waves`);
    record('QA Waves', qaWaves.ok && qaWaves.bodyText.length > 50 ? 'PASS' : 'FAIL', qaWaves.ok ? `Content: ${qaWaves.bodyText.length} chars` : qaWaves.error);
    if (qaWaves.ok) await screenshot(page, '06-qa-waves');

    // ================================================================
    // 7. RPA Replays
    // ================================================================
    console.log('[7] RPA Replays...');
    const replays = await safeGoto(`${BASE_URL}/dev/rpa-replays`);
    record('RPA Replays', replays.ok && replays.bodyText.length > 50 ? 'PASS' : 'FAIL', replays.ok ? `Content: ${replays.bodyText.length} chars` : replays.error);
    if (replays.ok) await screenshot(page, '07-rpa-replays');

    // ================================================================
    // 8. Sidebar/Menu
    // ================================================================
    console.log('[8] Menu...');
    const sidebarWs = await safeGoto(`${BASE_URL}/workspace`);
    if (sidebarWs.ok) {
      const sidebar = await page.$('nav, [class*="sidebar"], [class*="Sidebar"], [class*="menu"]');
      if (sidebar) {
        const sidebarText = await sidebar.textContent();
        record('Sidebar Workspace', sidebarText.includes('Workspace') || sidebarText.includes('workspace') ? 'PASS' : 'FAIL');
        record('Sidebar Inbox', sidebarText.includes('Inbox') || sidebarText.includes('Caixa') ? 'PASS' : 'FAIL');
        record('Sidebar Support', sidebarText.includes('Support') || sidebarText.includes('Suporte') || sidebarText.includes('Atendimento') ? 'PASS' : 'FAIL');
      } else {
        record('Sidebar', 'FAIL', 'Not found');
      }
      await screenshot(page, '08-sidebar');
    }

    // ================================================================
    // 9. API
    // ================================================================
    console.log('[9] API...');
    try {
      const apiRes = await page.evaluate(async () => {
        const res = await fetch('/api/auth/me');
        return { status: res.status, ok: res.ok };
      });
      record('API /auth/me', apiRes.status === 200 ? 'PASS' : 'FAIL', `Status: ${apiRes.status}`);
    } catch (_) {
      record('API /auth/me', 'FAIL', 'fetch failed');
    }

    // ================================================================
    // 10. Console & Network
    // ================================================================
    console.log('[10] Console/Network...');
    record('Console errors', consoleErrors.length === 0 ? 'PASS' : 'WARN', `${consoleErrors.length} errors`);
    const criticalFailures = networkFailures.filter(u => !u.includes('/auth/me') && !u.includes('favicon'));
    record('Network', criticalFailures.length === 0 ? 'PASS' : 'WARN', `${criticalFailures.length} failures`);

  } catch (err) {
    console.error('Test error:', err.message.split('\n')[0]);
    record('Exception', 'FAIL', err.message.split('\n')[0]);
  } finally {
    await browser.close();
  }

  // ================================================================
  // Report
  // ================================================================
  results.finishedAt = new Date().toISOString();
  const reportPath = path.join(EVIDENCE_DIR, 'browser-smoke-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log();
  console.log('='.repeat(60));
  console.log(`RESULTS: ${results.passed} PASS / ${results.failed} FAIL / ${results.tests.length} TOTAL`);
  console.log(`Report: ${reportPath}`);
  console.log('='.repeat(60));

  process.exit(results.failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
