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
    const messages = [];
    
    // Capture ALL console messages
    page.on('console', msg => {
      const type = msg.type();
      messages.push({
        type,
        text: msg.text(),
        args: msg.args().length
      });
      
      // Log important messages
      if (type === 'error' || type === 'warn' || msg.text().includes('Token') || msg.text().includes('login')) {
        console.log(`[${type.toUpperCase()}] ${msg.text()}`);
      }
    });
    
    console.log('\n🔐 TESTING LOGIN WITH STORAGE MONITORING\n');
    console.log('='.repeat(70));

    // Navigate to login
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Check localStorage before login
    const beforeLogin = await page.evaluate(() => {
      return {
        token: localStorage.getItem('auth_token'),
        agent: localStorage.getItem('auth_agent'),
        keys: Object.keys(localStorage)
      };
    });

    console.log('\n1️⃣ Before login:');
    console.log('   Token:', beforeLogin.token ? '✅ PRESENT' : '❌ MISSING');
    console.log('   Agent:', beforeLogin.agent ? '✅ PRESENT' : '❌ MISSING');
    console.log('   Storage keys:', beforeLogin.keys);

    // Fill and submit form
    console.log('\n2️⃣ Submitting login form...');
    
    await page.fill('input[name="username"]', 'systemadmin');
    await page.fill('input[name="password"]', 'Admin123!');
    
    // Before clicking, add a listener to catch any network errors
    let loginResponseReceived = false;
    let loginError = null;
    
    page.on('response', response => {
      if (response.url().includes('/auth/login')) {
        console.log(`[NETWORK] ${response.status()} ${response.url()}`);
        loginResponseReceived = true;
        
        // Try to read response
        response.text().then(text => {
          console.log(`[NETWORK] Response body length: ${text.length}`);
          if (text.startsWith('{')) {
            try {
              const json = JSON.parse(text);
              console.log(`[NETWORK] Response is valid JSON with keys: ${Object.keys(json).join(', ')}`);
              if (json.token) {
                console.log(`[NETWORK] ✅ Token found in response: ${json.token.substring(0, 30)}...`);
              }
            } catch (e) {
              console.log(`[NETWORK] Invalid JSON: ${text.substring(0, 100)}`);
            }
          }
        }).catch(err => {
          console.log(`[NETWORK] Error reading response: ${err.message}`);
        });
      }
    });
    
    page.on('error', err => {
      loginError = err;
      console.log(`[ERROR] Page error: ${err.message}`);
    });

    // Click login
    await page.click('button:has-text("Entrar")', { timeout: 5000 });
    console.log('   ✅ Login button clicked');

    // Wait for navigation or timeout
    try {
      await page.waitForNavigation({ timeout: 3000 }).catch(() => {
        console.log('   ⚠️  No navigation after login (may be expected)');
      });
    } catch (e) {
      console.log('   ⚠️  Navigation timeout:', e.message);
    }

    // Wait a bit for any async operations
    await page.waitForTimeout(2000);

    // Check localStorage after login
    const afterLogin = await page.evaluate(() => {
      return {
        token: localStorage.getItem('auth_token'),
        agent: localStorage.getItem('auth_agent'),
        keys: Object.keys(localStorage),
        url: window.location.href,
        pathname: window.location.pathname
      };
    });

    console.log('\n3️⃣ After login (after 2 seconds):');
    console.log('   Token:', afterLogin.token ? `✅ PRESENT (${afterLogin.token.length} chars)` : '❌ MISSING');
    console.log('   Agent:', afterLogin.agent ? '✅ PRESENT' : '❌ MISSING');
    console.log('   URL:', afterLogin.url);
    console.log('   Storage keys:', afterLogin.keys);
    console.log('   Network response received:', loginResponseReceived ? '✅ YES' : '❌ NO');

    if (afterLogin.token) {
      console.log(`\n   ✅ SUCCESS! Token saved: ${afterLogin.token.substring(0, 50)}...`);
    } else {
      console.log(`\n   ❌ FAILED! Token not in localStorage`);
      console.log(`\n   Console messages (${messages.length} total):`);
      messages.forEach(m => {
        if (m.type === 'error' || m.type === 'warn' || m.text.includes('undefined')) {
          console.log(`      [${m.type}] ${m.text}`);
        }
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
