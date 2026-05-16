#!/usr/bin/env node

'use strict';

const { chromium } = require('playwright');
const { loginWithTenantSelection } = require('../../tests/helpers/playwrightAuth');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const TARGET_PATH = '/demo?vertical=fitness';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';
const TENANT_NAME = process.env.TEST_TENANT_NAME || 'System';

function log(ok, message) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${message}`);
}

async function assertVisible(locator, label, timeout = 30000) {
  await locator.waitFor({ state: 'visible', timeout });
  const visible = await locator.isVisible();
  log(visible, label);
  if (!visible) {
    throw new Error(label);
  }
}

async function run() {
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let loginError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await loginWithTenantSelection(page, {
          targetUrl: `${BASE_URL}${TARGET_PATH}`,
          username: USERNAME,
          password: PASSWORD,
          tenantId: TENANT_ID,
          tenantName: TENANT_NAME,
        });
        loginError = null;
        break;
      } catch (error) {
        loginError = error;
        console.warn(`[WARN] Tentativa ${attempt}/3 de loginWithTenantSelection falhou: ${error.message}`);
        await page.waitForTimeout(900);
      }
    }

    if (loginError) {
      throw loginError;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
    await page.waitForTimeout(1200);

    const currentUrl = page.url();
    const onDemo = currentUrl.includes('/demo');
    log(onDemo, `URL autenticada em /demo (${currentUrl})`);
    if (!onDemo) {
      throw new Error(`URL inesperada apos login: ${currentUrl}`);
    }

    await assertVisible(page.getByText('DEMO COMERCIAL UNIFICADA').first(), 'Hero da demo visivel');
    await assertVisible(page.getByRole('button', { name: 'Fitness' }).first(), 'Botao Fitness visivel');
    await assertVisible(page.getByRole('button', { name: 'Beauty' }).first(), 'Botao Beauty visivel');
    await assertVisible(page.getByRole('button', { name: /Executar fluxo demo/i }).first(), 'Botao Executar fluxo demo visivel');

    await page.getByRole('button', { name: 'Beauty' }).first().click();
    await page.waitForTimeout(800);

    const beautyUrl = page.url();
    const beautyMode = beautyUrl.includes('/demo') && beautyUrl.includes('vertical=beauty');
    log(beautyMode, `Switch de vertical para beauty ok (${beautyUrl})`);
    if (!beautyMode) {
      throw new Error(`Switch para beauty falhou: ${beautyUrl}`);
    }

    console.log('\nDEMO SMOKE RESULT: PASS');

    await context.close();
    await browser.close();
  } catch (error) {
    console.error(`\nDEMO SMOKE RESULT: FAIL - ${error.message}`);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

run();
