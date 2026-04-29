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
    
    const consoleLogs = [];
    const errors = [];
    
    // Capture console messages
    page.on('console', msg => {
      const log = {
        type: msg.type(),
        text: msg.text(),
      };
      if (msg.type() === 'error') {
        errors.push(log);
      }
      consoleLogs.push(log);
    });
    
    console.log('\n🔍 INVESTIGATING ERROR MESSAGES\n');
    console.log('='.repeat(70));

    // Login
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

    // Navigate to RPA replays
    console.log('\n2️⃣ Loading RPA Replays page...');
    
    consoleLogs.length = 0; // Clear pre-load logs
    errors.length = 0;
    
    await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Get error messages from DOM
    console.log('\n3️⃣ Error messages found:');
    
    const errorElements = await page.evaluate(() => {
      const errorDivs = document.querySelectorAll('[class*="error"], [role="alert"][class*="error"]');
      return Array.from(errorDivs).map(el => ({
        text: el.innerText.substring(0, 100),
        className: el.className,
      })).slice(0, 10);
    });

    if (errorElements.length > 0) {
      console.log(`   Found ${errorElements.length} error elements:`);
      errorElements.forEach(err => {
        console.log(`      - ${err.text}`);
        console.log(`        Class: ${err.className.substring(0, 50)}`);
      });
    } else {
      console.log('   No error elements found in DOM');
    }

    // Get console errors
    console.log('\n4️⃣ Console errors:');
    const consoleErrors = consoleLogs.filter(l => l.type === 'error' || l.type === 'warn');
    if (consoleErrors.length > 0) {
      console.log(`   Found ${consoleErrors.length} console errors/warnings:`);
      consoleErrors.slice(0, 5).forEach(err => {
        console.log(`      [${err.type.toUpperCase()}] ${err.text.substring(0, 80)}`);
      });
    } else {
      console.log('   No console errors/warnings');
    }

    // Check loading state
    console.log('\n5️⃣ Page state:');
    const pageState = await page.evaluate(() => {
      return {
        title: document.title,
        buttons: document.querySelectorAll('button').length,
        inputs: document.querySelectorAll('input').length,
        textContent: document.body.innerText.substring(0, 200),
      };
    });

    console.log(`   Title: ${pageState.title}`);
    console.log(`   Buttons: ${pageState.buttons}`);
    console.log(`   Inputs: ${pageState.inputs}`);
    
    console.log('\n6️⃣ Page text (first 300 chars):');
    console.log('   ' + pageState.textContent.split('\n').slice(0, 5).join('\n   '));

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
