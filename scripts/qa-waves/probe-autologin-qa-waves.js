'use strict';

// Probe diagnóstico: executa apenas o auto-login RPA (loginStrategy=ui) com
// primeiro passo navigate /dev/qa-waves e reporta onde a página aterrissa,
// se o modal de tenant apareceu e o estado do storage de autenticação.

const { chromium } = require('playwright');
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');

(async () => {
  const browser = await chromium.launch({ headless: process.env.PROBE_HEADLESS === "1" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text() || '';
    if (/tenant|Tenant/.test(text)) console.log('[console]', text.slice(0, 160));
  });

  try {
    const result = await autoLoginBeforeSteps(page, {
      firstStep: { type: 'navigate', url: 'http://localhost:5173/dev/qa-waves' },
      authOptions: { loginStrategy: 'ui' },
      navigationTimeoutMs: 30000,
      waitAfterGotoMs: 1000,
    });
    console.log('autoLogin result:', JSON.stringify({ success: result.success, loggedIn: result.loggedIn, error: result.error || null }));
    await page.waitForTimeout(3000);
    console.log('final url:', page.url());

    const modalInfo = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.slice(0, 400) : '';
      return {
        hasTenantModal: /Selecione o Tenant/i.test(text),
        bodyStart: text.replace(/\s+/g, ' ').slice(0, 200),
        authLastTenant: localStorage.getItem('auth_last_tenant_id'),
        tenantProfile: localStorage.getItem('tenantProfile'),
        keys: Object.keys(localStorage),
      };
    });
    console.log('modal/storage:', JSON.stringify(modalInfo, null, 2));
    await page.screenshot({ path: '/tmp/probe11-final.png' });
  } catch (error) {
    console.error('probe error:', error.message);
  } finally {
    await browser.close();
  }
})();
