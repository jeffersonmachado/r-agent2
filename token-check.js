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
    
    // Intercept network
    const responses = [];
    page.on('response', async (response) => {
      if (response.url().includes('auth/login')) {
        const contentType = response.headers()['content-type'];
        try {
          const body = await response.text();
          responses.push({
            url: response.url(),
            status: response.status(),
            statusText: response.statusText(),
            contentType,
            body: body.substring(0, 500)
          });
        } catch (e) {
          // ignore
        }
      }
    });

    console.log('\n🔐 TOKEN VERIFICATION\n');
    console.log('='.repeat(70));

    // Navigate
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    console.log('\n1️⃣ Before Login:');
    const beforeLogin = await page.evaluate(() => {
      return {
        token: localStorage.getItem('auth_token') || 'NOT SET',
        authAgent: localStorage.getItem('auth_agent') ? 'SET' : 'NOT SET',
        allKeys: Object.keys(localStorage)
      };
    });

    console.log(`   Token: ${beforeLogin.token === 'NOT SET' ? '❌' : '✅'} ${beforeLogin.token}`);
    console.log(`   Auth Agent: ${beforeLogin.authAgent}`);
    console.log(`   LocalStorage keys: ${beforeLogin.allKeys.length}`);

    // Fill form
    console.log('\n2️⃣ Filling login form...');
    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill('systemadmin');
      await passwordInput.fill('Admin123!');
      console.log('   ✅ Form filled');

      // Click button
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.innerText();
        if (text.includes('Entrar')) {
          console.log('   ✅ Clicking login button');
          await btn.click();
          break;
        }
      }

      // Wait
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (e) {}

      await page.waitForTimeout(3000);
    }

    console.log('\n3️⃣ After Login:');
    const afterLogin = await page.evaluate(() => {
      return {
        token: localStorage.getItem('auth_token') || 'NOT SET',
        authAgent: localStorage.getItem('auth_agent') || 'NOT SET (but key exists)',
        url: window.location.href,
        allKeys: Object.keys(localStorage)
      };
    });

    console.log(`   URL: ${afterLogin.url}`);
    console.log(`   Token: ${afterLogin.token === 'NOT SET' ? '❌' : '✅'} ${afterLogin.token.substring(0, 50)}`);
    console.log(`   Auth Agent: ${afterLogin.authAgent}`);
    console.log(`   LocalStorage keys (${afterLogin.allKeys.length}):`);
    afterLogin.allKeys.forEach(k => console.log(`     - ${k}`));

    // Now make the API call
    console.log('\n4️⃣ Making API call with current token:');
    const apiCallDetails = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      const headers = {
        'Authorization': token ? `Bearer ${token}` : 'NO TOKEN',
        'Accept': 'application/json'
      };

      console.log('[Page] API headers:', headers);
      
      const response = await fetch('/api/test-executions/replays?limit=10');
      const data = await response.json();

      return {
        tokenSent: token ? 'YES' : 'NO',
        status: response.status,
        statusText: response.statusText,
        dataKeys: typeof data === 'object' ? Object.keys(data) : 'not-object',
        dataPreview: typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200)
      };
    });

    console.log(`   Token sent: ${apiCallDetails.tokenSent}`);
    console.log(`   Response status: ${apiCallDetails.status}`);
    console.log(`   Response data keys: ${apiCallDetails.dataKeys}`);
    console.log(`   Data preview: ${apiCallDetails.dataPreview}`);

    // Check network responses
    console.log('\n5️⃣ Network responses captured:');
    if (responses.length > 0) {
      responses.forEach((resp, idx) => {
        console.log(`   Response ${idx + 1}:`);
        console.log(`     Status: ${resp.status} ${resp.statusText}`);
        console.log(`     Body: ${resp.body}`);
      });
    } else {
      console.log('   (No auth/login responses captured)');
    }

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
