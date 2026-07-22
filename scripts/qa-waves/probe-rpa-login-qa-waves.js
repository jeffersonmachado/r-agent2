'use strict';
/* Probe 2: usa o login REAL do RPA (ensureAuthenticated) e testa /dev/qa-waves. */
const path = require('path');
function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(path.join(__dirname, '..', '..', 'frontend-e2e', 'node_modules', 'playwright'));
  }
}
const { chromium } = loadPlaywright();
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

  const firstStep = { type: 'navigate', url: '{{urls.frontend}}/dev/qa-waves' };
  const result = await autoLoginBeforeSteps(page, {
    firstStep,
    autoLogin: true,
    frontendBaseUrl: 'http://localhost:5173',
    authOptions: { loginStrategy: process.env.LOGIN_STRATEGY || 'ui' },
  });
  console.log('autoLogin:', JSON.stringify({ success: result.success, loggedIn: result.loggedIn, error: result.error }));
  console.log('url pós-autoLogin:', page.url());

  await page.goto('http://localhost:5173/dev/qa-waves', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const title = await page.locator('h1.qa-waves-title').isVisible().catch(() => false);
  console.log('url final:', page.url(), '| qa-waves-title visível:', title);
  const ls = await page.evaluate(() => Object.keys(window.localStorage || {}));
  console.log('localStorage keys:', JSON.stringify(ls));
  await page.screenshot({ path: '/tmp/probe2-qa-waves.png' });
  await browser.close();
})().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
