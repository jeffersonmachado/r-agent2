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
    
    console.log('\n🔐 TESTING LOGIN - FIXING SELECTORS\n');
    console.log('='.repeat(70));

    // Navigate to login
    console.log('\n1️⃣ Navigating to /login...');
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });

    // Check localStorage before
    const before = await page.evaluate(() => ({
      token: localStorage.getItem('auth_token'),
      agent: localStorage.getItem('auth_agent'),
    }));
    
    console.log(`\n2️⃣ Before login:`);
    console.log(`   Token: ${before.token ? '✅' : '❌'}`);
    console.log(`   Agent: ${before.agent ? '✅' : '❌'}`);

    // Fill form with correct selectors
    console.log('\n3️⃣ Filling form...');
    
    // Get all inputs and fill by position
    const inputs = await page.$$('input');
    console.log(`   Found ${inputs.length} inputs`);
    
    if (inputs.length >= 2) {
      // First input = username
      await inputs[0].fill('systemadmin');
      console.log('   ✅ Username filled');
      
      // Second input = password
      await inputs[1].fill('Admin123!');
      console.log('   ✅ Password filled');
    } else {
      console.log('   ❌ Not enough inputs found!');
      return;
    }

    // Find and click submit button
    console.log('\n4️⃣ Submitting form...');
    const buttons = await page.$$('button');
    let submitButton = null;
    
    for (const button of buttons) {
      const text = await button.textContent();
      if (text.toLowerCase().includes('entrar') || text.toLowerCase().includes('login')) {
        submitButton = button;
        break;
      }
    }
    
    if (!submitButton) {
      console.log('   ❌ Submit button not found!');
      console.log('   Button texts:');
      for (const button of buttons) {
        const text = await button.textContent();
        console.log(`      - "${text.trim()}"`);
      }
      return;
    }
    
    await submitButton.click();
    console.log('   ✅ Button clicked');

    // Wait for response
    console.log('\n5️⃣ Waiting for login response (3 seconds)...');
    await page.waitForTimeout(3000);

    // Check localStorage after
    const after = await page.evaluate(() => ({
      token: localStorage.getItem('auth_token'),
      agent: localStorage.getItem('auth_agent'),
      pathname: window.location.pathname,
      url: window.location.href
    }));

    console.log(`\n6️⃣ After login:`);
    console.log(`   Token: ${after.token ? `✅ (${after.token.substring(0, 30)}...)` : '❌ MISSING'}`);
    console.log(`   Agent: ${after.agent ? '✅' : '❌'}`);
    console.log(`   URL: ${after.url}`);
    console.log(`   Pathname: ${after.pathname}`);

    if (after.token) {
      console.log(`\n✅ SUCCESS! Token saved to localStorage`);
    } else {
      console.log(`\n❌ FAILED! Token not in localStorage`);
      
      // Try to capture what's in localStorage
      const allStorage = await page.evaluate(() => {
        const items = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          items[key] = localStorage.getItem(key);
        }
        return items;
      });
      
      console.log('\n   Current localStorage:');
      Object.entries(allStorage).forEach(([k, v]) => {
        const val = typeof v === 'string' ? (v.length > 50 ? v.substring(0, 50) + '...' : v) : v;
        console.log(`      ${k}: ${val}`);
      });
    }

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
