#!/usr/bin/env node

const { chromium } = require('playwright');
const { loginWithTenantSelection } = require('./tests/helpers/playwrightAuth');

const BASE_URL = 'http://127.0.0.1:5173/dev/rpa-replays';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';

(async () => {
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    
    console.log('\n✅ COMPLETE FLOW V2\n');
    console.log('='.repeat(70));

    // Login + tenant
    console.log(`\n1️⃣ Logging in and selecting tenant (${TENANT_ID})...`);
    await loginWithTenantSelection(page, {
      targetUrl: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });
    await page.waitForTimeout(3000);
    console.log('   ✅ Login/tenant complete');

    // Check final state
    console.log('\n2️⃣ Final state:');
    
    const finalState = await page.evaluate(() => ({
      url: window.location.href,
      pathname: window.location.pathname,
      hasTable: !!document.querySelector('table'),
      rows: document.querySelectorAll('table tbody tr').length,
    }));

    console.log(`   URL: ${finalState.url}`);
    console.log(`   Pathname: ${finalState.pathname}`);
    console.log(`   Has table: ${finalState.hasTable ? '✅' : '❌'}`);
    console.log(`   Rows: ${finalState.rows}`);

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
