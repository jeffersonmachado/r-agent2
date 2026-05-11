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
    
    console.log('\n✅ COMPLETE END-TO-END FLOW\n');
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

    // Wait for navigation/page load
    await page.waitForTimeout(3000);

    // STEP 2: Check if we're on replays page
    console.log('\n2️⃣ Checking final state...');
    
    const finalState = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        hasTable: !!document.querySelector('table'),
        tableRows: document.querySelectorAll('table tbody tr').length,
        hasCheckbox: !!document.querySelector('input[type="checkbox"]'),
        pageText: document.body.innerText.substring(0, 300),
      };
    });

    console.log(`   URL: ${finalState.url}`);
    console.log(`   Pathname: ${finalState.pathname}`);
    console.log(`   Title: ${finalState.title}`);
    console.log(`   Has table: ${finalState.hasTable ? '✅' : '❌'}`);
    console.log(`   Table rows: ${finalState.tableRows}`);
    console.log(`   Has checkbox: ${finalState.hasCheckbox ? '✅' : '❌'}`);

    // STEP 3: Get sample replays
    if (finalState.hasTable && finalState.tableRows > 0) {
      console.log('\n3️⃣ Sample replays found:');
      
      const replayNames = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows)
          .map(row => {
            const firstCell = row.querySelector('td:nth-child(2)'); // Skip checkbox column
            return firstCell ? firstCell.innerText.substring(0, 50) : '?';
          })
          .slice(0, 5);
      });

      replayNames.forEach((name, i) => console.log(`      ${i + 1}. ${name}`));
    }

    console.log('\n' + '='.repeat(70));
    
    if (finalState.hasTable && finalState.tableRows > 0) {
      console.log('\n✅ SUCCESS! RPA Replays page loaded with ' + finalState.tableRows + ' replays');
    } else if (finalState.pathname === '/dev/rpa-replays') {
      console.log('\n⚠️  Page navigated to /dev/rpa-replays but no table visible yet (may be loading)');
    } else {
      console.log('\n❌ Not on RPA Replays page yet (' + finalState.pathname + ')');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
