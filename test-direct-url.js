#!/usr/bin/env node

const { chromium } = require('playwright');

(async () => {
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    
    console.log('\n🚀 DIRECT URL ACCESS TEST\n');
    console.log('='.repeat(70));

    // STEP 1: Login
    console.log('\n1️⃣ Logging in...');
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
    
    const inputs = await page.$$('input');
    await inputs[0].fill('systemadmin');
    await inputs[1].fill('Admin123!');
    
    const buttons = await page.$$('button');
    for (const button of buttons) {
      const text = await button.textContent();
      if (text.toLowerCase().includes('entrar')) {
        await button.click();
        break;
      }
    }
    
    await page.waitForTimeout(2500);

    // Verify token is saved
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    console.log(`   Token saved: ${token ? '✅' : '❌'}`);

    // STEP 2: Navigate directly to RPA Replays via URL
    console.log('\n2️⃣ Navigating directly to /rpa-replays...');
    
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.log(`   ⚠️  Navigation timeout, continuing anyway: ${e.message}`);
    }
    await page.waitForTimeout(3000);

    // STEP 3: Check page state
    console.log('\n3️⃣ Checking page...');
    
    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        hasTable: !!document.querySelector('table'),
        tableRows: document.querySelectorAll('table tbody tr').length,
        pageLength: document.body.innerText.length,
      };
    });

    console.log(`   URL: ${pageState.url}`);
    console.log(`   Pathname: ${pageState.pathname}`);
    console.log(`   Has table: ${pageState.hasTable ? '✅' : '❌'}`);
    console.log(`   Rows: ${pageState.tableRows}`);

    // STEP 4: Get replays if table exists
    if (pageState.hasTable) {
      console.log('\n4️⃣ Replays found:');
      
      const replays = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows)
          .map((row, i) => ({
            index: i + 1,
            text: row.innerText.substring(0, 80),
          }))
          .slice(0, 5);
      });

      replays.forEach(r => console.log(`      ${r.index}. ${r.text}`));

      console.log(`\n      Total rows: ${pageState.tableRows}`);
    } else {
      // Check for modal or error
      const bodyText = await page.innerText('body');
      if (bodyText.includes('Selecione o Tenant')) {
        console.log('   ⚠️  Tenant selection modal still showing');
      } else if (bodyText.includes('onboarding')) {
        console.log('   ⚠️  Redirected to onboarding');
      } else {
        console.log('   ⚠️  Page loaded but no table found');
      }
    }

    console.log('\n' + '='.repeat(70));
    
    if (pageState.hasTable && pageState.tableRows > 0) {
      console.log('\n✅ SUCCESS! RPA Replays accessible directly via URL');
    } else {
      console.log('\n⚠️  RPA Replays not accessible via direct URL');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
