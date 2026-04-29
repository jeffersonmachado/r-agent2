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
    
    console.log('\n✅ COMPLETE LOGIN + TENANT SELECTION + REPLAYS\n');
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
    console.log('   ✅ Login complete, modal appeared');

    // STEP 2: Select tenant from modal
    console.log('\n2️⃣ Selecting System tenant from modal...');
    
    // Click on the System tenant option
    const tenantOptions = await page.$$('[role="button"]');
    let foundSystemTenant = false;
    
    for (const option of tenantOptions) {
      const text = await option.textContent();
      if (text.includes('System')) {
        await option.click();
        console.log('   ✅ System tenant clicked');
        foundSystemTenant = true;
        break;
      }
    }

    if (!foundSystemTenant) {
      console.log('   ⚠️  System tenant not found, trying alternative selectors');
      // Try card selection
      const cards = await page.$$('[class*="card"], [class*="tenant"]');
      if (cards.length > 0) {
        await cards[0].click();
        console.log('   ✅ First card clicked');
      }
    }

    await page.waitForTimeout(1000);

    // Click Acessar button
    console.log('\n3️⃣ Clicking "Acessar" button...');
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
      const text = await btn.textContent();
      if (text.toLowerCase().includes('acessar') || text.toLowerCase().includes('access')) {
        await btn.click();
        console.log('   ✅ Acessar button clicked');
        break;
      }
    }

    // Wait for navigation/redirect
    await page.waitForTimeout(3000);

    // STEP 3: Check if we're on replays page
    console.log('\n4️⃣ Checking page state after tenant selection...');
    
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

    // STEP 4: Get replay data
    console.log('\n5️⃣ Checking for replays...');
    
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
