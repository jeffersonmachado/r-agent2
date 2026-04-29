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
    
    console.log('\n🔌 DIRECT API TEST\n');
    console.log('='.repeat(70));

    // Login first to get token
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

    // Get token
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    console.log(`\n1️⃣ Token obtained: ${token ? '✅' : '❌'}`);
    if (token) {
      console.log(`   Token: ${token.substring(0, 40)}...`);
    }

    // Make direct API call
    console.log('\n2️⃣ Calling /api/test-executions/replays...');
    
    const apiResponse = await page.evaluate(async (tok) => {
      try {
        const response = await fetch('/api/test-executions/replays?limit=10&offset=0', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tok}`,
            'Accept': 'application/json',
            'X-Tenant-Id': 'system',
            'Content-Type': 'application/json'
          }
        });

        const contentType = response.headers.get('content-type');
        
        if (!response.ok) {
          return {
            status: response.status,
            statusText: response.statusText,
            error: true,
            body: await response.text()
          };
        }

        const data = await response.json();
        return {
          status: response.status,
          statusText: response.statusText,
          error: false,
          files: data.files ? data.files.length : 0,
          pagination: data.pagination,
          sample: data.files ? data.files.slice(0, 2) : []
        };
      } catch (err) {
        return { error: true, message: err.message };
      }
    }, token);

    console.log(`   Status: ${apiResponse.status}`);
    console.log(`   Status Text: ${apiResponse.statusText}`);
    
    if (apiResponse.error) {
      console.log(`   ❌ Error: ${apiResponse.message || apiResponse.body}`);
    } else {
      console.log(`   ✅ Files returned: ${apiResponse.files}`);
      console.log(`   Pagination: ${JSON.stringify(apiResponse.pagination)}`);
      if (apiResponse.sample.length > 0) {
        console.log(`\n   Sample replays:`);
        apiResponse.sample.forEach(replay => {
          console.log(`      - ${replay.filename || replay.replayId || 'unknown'}`);
        });
      }
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
