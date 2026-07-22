'use strict';
/* Probe: reproduz o fluxo de login do RPA e testa se /dev/qa-waves redireciona. */
const path = require('path');
function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(path.join(__dirname, '..', '..', 'frontend-e2e', 'node_modules', 'playwright'));
  }
}
const { chromium } = loadPlaywright();

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADLESS === '1' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

  await page.goto('http://localhost:5173/dev/qa-waves', { waitUntil: 'domcontentloaded' });
  const onLogin = await page.locator('text=Login de Agente').isVisible().catch(() => false);
  console.log('login visível:', onLogin, '| url:', page.url());
  if (onLogin) {
    await page.locator('input[placeholder*="username" i]').fill('systemadmin');
    await page.locator('input[type="password"]').fill('Admin123!');
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);
  console.log('pós-login url:', page.url());

  // modal tenant
  const modal = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
  if (await modal.isVisible().catch(() => false)) {
    await modal.locator('text=System').first().click({ force: true }).catch(() => {});
    await page.getByRole('button', { name: /^Acessar$/i }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  console.log('pós-modal url:', page.url());

  // detour /support (como finalizeAuthenticatedState do RPA faz)
  await page.goto('http://localhost:5173/support', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log('pós-/support url:', page.url());

  await page.goto('http://localhost:5173/dev/qa-waves', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const title = await page.locator('h1.qa-waves-title').isVisible().catch(() => false);
  console.log('pós-redirect-test url:', page.url(), '| qa-waves-title visível:', title);
  await page.screenshot({ path: '/tmp/probe-qa-waves.png' });

  await browser.close();
})().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
