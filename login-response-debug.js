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
    
    // Capture ALL responses including auth/login
    const allResponses = [];
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (url.includes('login') || url.includes('auth')) {
          const status = response.status();
          const statusText = response.statusText();
          let body = '';
          try {
            body = await response.text();
          } catch (e) {}
          
          allResponses.push({
            url,
            status,
            statusText,
            body: body.substring(0, 800)
          });
        }
      } catch (e) {}
    });

    console.log('\n🔍 LOGIN RESPONSE DEBUG\n');
    console.log('='.repeat(70));

    // Navigate
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    console.log('\n1️⃣ Found login form:');
    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');
    console.log(`   Username input: ${usernameInput ? '✅' : '❌'}`);
    console.log(`   Password input: ${passwordInput ? '✅' : '❌'}`);

    // Fill form
    if (usernameInput && passwordInput) {
      await usernameInput.fill('systemadmin');
      await passwordInput.fill('Admin123!');

      console.log('\n2️⃣ Clicking login button...');
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.innerText();
        if (text.includes('Entrar')) {
          await btn.click();
          break;
        }
      }

      // Wait for response
      await page.waitForTimeout(5000);

      console.log('\n3️⃣ Network responses captured:');
      allResponses.forEach((resp, idx) => {
        console.log(`\n   Response ${idx + 1}:`);
        console.log(`     URL: ${resp.url}`);
        console.log(`     Status: ${resp.status} ${resp.statusText}`);
        console.log(`     Body:`);
        console.log(`     ${resp.body}`);
      });

      if (allResponses.length === 0) {
        console.log('   (No login responses captured)');
      }
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
