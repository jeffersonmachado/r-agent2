'use strict';
/* Probe 13: replica 1:1 o caminho do rpaService (RpaTestRunner + tracing +
   autoLoginBeforeSteps na página do executor) e despeja URL/storage/screenshot.
   Uso: PROBE_TRACING=0 para desligar tracing e comparar. */
process.env.RUNTIME_ROOT = process.env.RUNTIME_ROOT || '/tmp/ragent2-runtime-dev';

const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');

(async () => {
  const recording = require('../../rpa/seeds/fitness-matricula-leads.json');
  const runner = new RpaTestRunner({
    headless: true,
    slowMo: 0,
    timeout: 30000,
    screenshotOnFailure: true,
    devtools: false,
  });

  await runner.init();

  if (process.env.PROBE_TRACING !== '0' && runner.executor?.startTracing) {
    await runner.executor.startTracing({ screenshots: true, snapshots: true, sources: true });
    console.log('tracing: ON');
  } else {
    console.log('tracing: OFF');
  }

  const page = runner.executor.page;
  const authResult = await autoLoginBeforeSteps(page, {
    firstStep: recording.steps?.[0],
    autoLogin: recording?.metadata?.autoLogin !== false,
    templateData: { ...(recording.data || {}) },
    authOptions: recording?.metadata?.authOptions || {},
    frontendBaseUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:3001',
  });
  console.log('authResult:', JSON.stringify({ success: authResult.success, loggedIn: authResult.loggedIn, error: authResult.error || null }));

  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    url: window.location.href,
    authLastTenant: localStorage.getItem('auth_last_tenant_id'),
    effectiveTenant: localStorage.getItem('auth_effective_tenant_id'),
    agent: (() => { try { const a = JSON.parse(localStorage.getItem('auth_agent')); return { tenantId: a?.tenantId, role: a?.role, username: a?.username }; } catch { return null; } })(),
    hasQaTitle: !!document.querySelector('h1.qa-waves-title'),
    bodyStart: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 150),
  }));
  console.log('state:', JSON.stringify(state, null, 2));
  await page.screenshot({ path: '/tmp/probe13-final.png' });

  await runner.close();
})().catch((e) => { console.error('PROBE FAIL:', e); process.exit(1); });
