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
    
    // Capture ALL network requests
    const networkData = [];
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        networkData.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('401')) {
        consoleErrors.push(msg.text());
      }
    });

    console.log('\n🔍 API RESPONSE DEBUG\n');
    console.log('='.repeat(70));

    // Navigate
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
    } catch (e) {}
    await page.waitForTimeout(2000);

    // Login
    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill('systemadmin');
      await passwordInput.fill('Admin123!');

      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.innerText();
        if (text.includes('Entrar')) {
          await btn.click();
          break;
        }
      }

      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (e) {}
      await page.waitForTimeout(3000);
    }

    console.log('\n1️⃣ Network requests to API:');
    networkData.forEach(req => {
      console.log(`   ${req.status} ${req.url}`);
    });

    // Get actual API response
    console.log('\n2️⃣ Actual API response structure:');
    const apiFullData = await page.evaluate(async () => {
      const response = await fetch('/api/test-executions/replays?limit=200');
      const data = await response.json();
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        isArray: Array.isArray(data),
        type: typeof data,
        keys: typeof data === 'object' ? Object.keys(data).slice(0, 10) : null,
        firstItem: Array.isArray(data) ? data[0] : null,
        length: Array.isArray(data) ? data.length : Object.keys(data || {}).length,
        hasError: data?.error || data?.message,
        dataPreview: JSON.stringify(data).substring(0, 500)
      };
    });

    console.log(`   Status: ${apiFullData.status}`);
    console.log(`   Content-Type: ${apiFullData.contentType}`);
    console.log(`   Is Array: ${apiFullData.isArray}`);
    console.log(`   Type: ${apiFullData.type}`);
    console.log(`   Keys: ${apiFullData.keys}`);
    console.log(`   Length: ${apiFullData.length}`);
    
    if (apiFullData.hasError) {
      console.log(`   ❌ ERROR: ${apiFullData.hasError}`);
    }

    console.log(`\n   Data preview:\n${apiFullData.dataPreview}`);

    // Check first item details
    if (apiFullData.firstItem) {
      console.log('\n3️⃣ First item structure:');
      console.log('   Keys:', Object.keys(apiFullData.firstItem));
      console.log('   Values:', JSON.stringify(apiFullData.firstItem, null, 2).substring(0, 600));
    }

    // Console errors
    if (consoleErrors.length > 0) {
      console.log('\n4️⃣ Console errors captured:');
      consoleErrors.slice(0, 5).forEach(err => {
        console.log(`   ❌ ${err}`);
      });
    }

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
