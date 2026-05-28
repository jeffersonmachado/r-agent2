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
    
    console.log('\n✅ COMPLETE LOGIN + TENANT SELECTION + REPLAYS\n');
    console.log('='.repeat(70));

    // STEP 1: Login + tenant
    console.log(`\n1️⃣ Logging in and selecting tenant (${TENANT_ID})...`);
    await loginWithTenantSelection(page, {
      targetUrl: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });
    console.log('   ✅ Login/tenant complete');

    // Wait for navigation/redirect
    await page.waitForTimeout(3000);

    // STEP 2: Check if we're on replays page
    console.log('\n2️⃣ Checking page state after tenant selection...');
    
    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        hasTable: !!document.querySelector('table'),
        hasData: document.body.innerText.includes('Arquivo') || document.body.innerText.includes('Resultado'),
        textLength: document.body.innerText.length,
      };
    });

    console.log(`   URL: ${pageState.url}`);
    console.log(`   Pathname: ${pageState.pathname}`);
    console.log(`   Has table: ${pageState.hasTable ? '✅' : '❌'}`);
    console.log(`   Has replay data: ${pageState.hasData ? '✅' : '❌'}`);

    // STEP 3: Get replay data
    console.log('\n3️⃣ Checking for replays...');
    
    const replayData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const cells = document.querySelectorAll('table tbody td');
      
      // Get first few file names
      const links = Array.from(document.querySelectorAll('a'))
        .filter(a => a.textContent.includes('.json') || a.textContent.includes('replay'))
        .map(a => a.textContent.trim())
        .slice(0, 5);

      return {
        rows: rows.length,
        cells: cells.length,
        files: links,
      };
    });

    console.log(`   Table rows: ${replayData.rows}`);
    console.log(`   Cells in table: ${replayData.cells}`);
    console.log(`   Sample files:`);
    replayData.files.forEach(f => console.log(`      - ${f.substring(0, 50)}`));

    console.log('\n' + '='.repeat(70));
    
    if (replayData.rows > 0) {
      console.log('\n✅ SUCCESS! Replays are visible after tenant selection');
    } else {
      console.log('\n⚠️  Still no replays visible');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
