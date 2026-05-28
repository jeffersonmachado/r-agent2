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
    
    console.log('\n🔐 TESTING LOGIN\n');
    console.log('='.repeat(70));

    // Navigate to login
    console.log('\n1️⃣ Navigating to /login...');
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check if we're on login page
    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    // Check for form elements
    console.log('\n2️⃣ Checking for form...');
    
    const hasForm = await page.evaluate(() => {
      return {
        usernameInputs: document.querySelectorAll('input[name="username"]').length,
        passwordInputs: document.querySelectorAll('input[name="password"]').length,
        buttons: document.querySelectorAll('button').length,
        bodyText: document.body.innerText.substring(0, 200)
      };
    });
    
    console.log(`   Username inputs: ${hasForm.usernameInputs}`);
    console.log(`   Password inputs: ${hasForm.passwordInputs}`);
    console.log(`   Buttons: ${hasForm.buttons}`);
    
    if (hasForm.usernameInputs === 0) {
      console.log('\n   ⚠️  Form not found! Page content:');
      console.log('   ' + hasForm.bodyText.split('\n').slice(0, 5).join('\n   '));
      console.log('\n   Dumping all inputs:');
      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(i => ({
          type: i.type,
          name: i.name,
          id: i.id,
          visible: i.offsetParent !== null
        }));
      });
      inputs.forEach(inp => console.log(`      - ${inp.type} (name=${inp.name}, id=${inp.id}, visible=${inp.visible})`));
      return;
    }

    // Check localStorage before
    const before = await page.evaluate(() => ({
      token: localStorage.getItem('auth_token'),
      keys: Object.keys(localStorage)
    }));
    
    console.log(`\n3️⃣ Before login: Token = ${before.token ? '✅ PRESENT' : '❌ MISSING'}`);

    // Try different selectors for username
    const usernameSelector = 'input[name="username"], input#username, input[placeholder*="user" i], input[placeholder*="email" i]';
    const passwordSelector = 'input[name="password"], input#password, input[type="password"]';
    const buttonSelector = 'button:has-text("Entrar"), button:has-text("Login"), button:has-text("Sign"), button[type="submit"]';

    console.log('\n4️⃣ Filling form...');
    
    try {
      await page.fill(usernameSelector, 'systemadmin', { timeout: 5000 });
      console.log('   ✅ Username filled');
    } catch (e) {
      console.log(`   ❌ Failed to fill username: ${e.message}`);
      const inputs = await page.$$('input');
      console.log(`   Found ${inputs.length} inputs total`);
      for (let i = 0; i < Math.min(inputs.length, 5); i++) {
        const name = await inputs[i].getAttribute('name');
        const type = await inputs[i].getAttribute('type');
        console.log(`      Input ${i}: type=${type}, name=${name}`);
      }
      return;
    }

    try {
      await page.fill(passwordSelector, 'Admin123!', { timeout: 5000 });
      console.log('   ✅ Password filled');
    } catch (e) {
      console.log(`   ❌ Failed to fill password: ${e.message}`);
      return;
    }

    // Click button
    console.log('\n5️⃣ Clicking login button...');
    
    try {
      await page.click(buttonSelector, { timeout: 5000 });
      console.log('   ✅ Button clicked');
    } catch (e) {
      console.log(`   ❌ Failed to click button: ${e.message}`);
      const buttons = await page.$$('button');
      console.log(`   Found ${buttons.length} buttons. Texts:`);
      for (let i = 0; i < Math.min(buttons.length, 3); i++) {
        const text = await buttons[i].textContent();
        console.log(`      Button ${i}: "${text.trim()}"`);
      }
      return;
    }

    // Wait for response
    console.log('\n6️⃣ Waiting for login response...');
    await page.waitForTimeout(3000);

    // Check localStorage after
    const after = await page.evaluate(() => ({
      token: localStorage.getItem('auth_token'),
      agent: localStorage.getItem('auth_agent'),
      keys: Object.keys(localStorage),
      url: window.location.href,
      pathname: window.location.pathname
    }));

    console.log(`   After login: Token = ${after.token ? '✅ PRESENT' : '❌ MISSING'}`);
    console.log(`   URL: ${after.url}`);
    console.log(`   Pathname: ${after.pathname}`);
    console.log(`   Storage keys: ${after.keys.join(', ')}`);

    if (after.token) {
      console.log(`\n   ✅ SUCCESS! Token: ${after.token.substring(0, 40)}...`);
    } else {
      console.log('\n   ❌ FAILED - token not saved!');
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
