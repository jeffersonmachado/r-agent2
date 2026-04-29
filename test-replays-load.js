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
    
    console.log('\n🎬 TESTING RPA REPLAYS AFTER LOGIN\n');
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

    await page.waitForTimeout(2000);

    const afterLogin = await page.evaluate(() => ({
      token: !!localStorage.getItem('auth_token'),
      agent: localStorage.getItem('auth_agent') ? JSON.parse(localStorage.getItem('auth_agent')).username : null,
    }));

    console.log(`   Token saved: ${afterLogin.token ? '✅' : '❌'}`);
    console.log(`   Agent: ${afterLogin.agent}`);

    // STEP 2: Navigate to RPA replays
    console.log('\n2️⃣ Navigating to RPA Replays page...');
    
    // Intercept network requests to capture API calls
    const apiCalls = [];
    page.on('response', response => {
      if (response.url().includes('test-executions/replays') || response.url().includes('rpa/replay')) {
        apiCalls.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });
      }
    });

    // Navigate to RPA page
    await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'networkidle' });
    
    // Wait for page to load
    await page.waitForTimeout(3000);

    // STEP 3: Check page state
    console.log('\n3️⃣ Checking RPA Replays page state...');
    
    const pageState = await page.evaluate(() => {
      const replayTable = document.querySelector('table');
      const replayGrid = document.querySelector('[class*="grid"]');
      const errorMessages = document.querySelectorAll('[class*="error"]');
      const loadingIndicators = document.querySelectorAll('[class*="loading"]');
      
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        hasTable: !!replayTable,
        hasGrid: !!replayGrid,
        errorCount: errorMessages.length,
        loadingCount: loadingIndicators.length,
        bodyText: document.body.innerText.substring(0, 300),
      };
    });

    console.log(`   URL: ${pageState.url}`);
    console.log(`   Has table: ${pageState.hasTable ? '✅' : '❌'}`);
    console.log(`   Has grid: ${pageState.hasGrid ? '✅' : '❌'}`);
    console.log(`   Error messages: ${pageState.errorCount}`);
    console.log(`   Loading indicators: ${pageState.loadingCount}`);

    // STEP 4: Check API calls
    console.log('\n4️⃣ API calls made:');
    if (apiCalls.length > 0) {
      apiCalls.forEach(call => {
        console.log(`   ${call.status} ${call.url.split('?')[0].split('/').pop()}`);
      });
      
      const has401 = apiCalls.some(c => c.status === 401);
      if (has401) {
        console.log(`   ❌ Got 401 Unauthorized!`);
      } else {
        console.log(`   ✅ No 401 errors`);
      }
    } else {
      console.log(`   ⚠️  No API calls captured`);
    }

    // STEP 5: Try to find replays in DOM
    console.log('\n5️⃣ Looking for replay data...');
    
    const replayData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const cards = document.querySelectorAll('[class*="replay"], [class*="card"]');
      const fileLinks = Array.from(document.querySelectorAll('a')).filter(a => a.textContent.includes('replay') || a.textContent.includes('wave'));
      
      return {
        tableRows: rows.length,
        cards: cards.length,
        files: fileLinks.map(a => a.textContent.substring(0, 50)).slice(0, 3),
      };
    });

    console.log(`   Table rows: ${replayData.tableRows}`);
    console.log(`   Cards: ${replayData.cards}`);
    if (replayData.files.length > 0) {
      console.log(`   Sample files: ${replayData.files.join(', ')}`);
    }

    console.log('\n' + '='.repeat(70));
    
    if (pageState.hasTable && replayData.tableRows > 0 && !apiCalls.some(c => c.status === 401)) {
      console.log('\n✅ SUCCESS! RPA Replays loaded without 401 errors');
    } else if (apiCalls.some(c => c.status === 401)) {
      console.log('\n❌ 401 Unauthorized - Token issue or session invalid');
    } else {
      console.log('\n⚠️  Page loaded but no replays visible');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
