#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    
    // Capture ALL console messages
    const logs = {
      errors: [],
      warnings: [],
      logs: [],
      network: []
    };

    page.on('console', msg => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url,
        timestamp: new Date().toISOString()
      };

      if (msg.type() === 'error') {
        logs.errors.push(entry);
      } else if (msg.type() === 'warning') {
        logs.warnings.push(entry);
      } else {
        logs.logs.push(entry);
      }

      // Print in real time
      const icon = msg.type() === 'error' ? '❌' : msg.type() === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`${icon} [${msg.type()}] ${msg.text().substring(0, 120)}`);
    });

    page.on('response', response => {
      if (response.url().includes('auth') || response.url().includes('login')) {
        logs.network.push({
          url: response.url(),
          status: response.status(),
          method: response.request().method(),
          timestamp: new Date().toISOString()
        });
      }
    });

    console.log('\n🔐 COMPLETE LOGIN FLOW DEBUG\n');
    console.log('='.repeat(70));

    // Navigate
    console.log('\n1️⃣ Navigate to /login');
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Fill form
    console.log('\n2️⃣ Filling form');
    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill('systemadmin');
      await passwordInput.fill('Admin123!');
      console.log('   ✅ Form filled');

      // Get current state before login
      const beforeLoginState = await page.evaluate(() => {
        return {
          token: localStorage.getItem('auth_token'),
          authAgent: localStorage.getItem('auth_agent'),
          allKeys: Object.keys(localStorage)
        };
      });

      console.log('\n3️⃣ Before login:');
      console.log(`   Token: ${beforeLoginState.token ? '✅' : '❌'}`);
      console.log(`   Auth Agent: ${beforeLoginState.authAgent ? '✅' : '❌'}`);

      // Click button
      console.log('\n4️⃣ Clicking login button');
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.innerText();
        if (text.includes('Entrar')) {
          await btn.click();
          console.log('   ✅ Button clicked');
          break;
        }
      }

      // Wait and capture logs
      await page.waitForTimeout(5000);

      // Get state after login
      const afterLoginState = await page.evaluate(() => {
        return {
          token: localStorage.getItem('auth_token'),
          authAgent: localStorage.getItem('auth_agent'),
          url: window.location.href,
          allKeys: Object.keys(localStorage)
        };
      });

      console.log('\n5️⃣ After login (waited 5 seconds):');
      console.log(`   Token: ${afterLoginState.token ? '✅' : '❌'}`);
      console.log(`   Auth Agent: ${afterLoginState.authAgent ? '✅' : '❌'}`);
      console.log(`   URL: ${afterLoginState.url}`);
      console.log(`   LocalStorage keys: ${afterLoginState.allKeys.join(', ')}`);

      if (afterLoginState.token) {
        console.log(`\n   ✅ Token saved: ${afterLoginState.token.substring(0, 50)}...`);
      } else {
        console.log(`\n   ❌ NO TOKEN IN LOCALSTORAGE!`);
      }

      // Now try to access replays
      if (afterLoginState.url.includes('rpa-replays') || afterLoginState.url === 'http://127.0.0.1:5173/') {
        console.log('\n6️⃣ Navigating to /rpa-replays');
        await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const replayPageData = await page.evaluate(() => {
          const allText = document.body.innerText;
          return {
            hasReplays: allText.includes('.json') || allText.includes('Arquivo'),
            url: window.location.href,
            hasErrorMessage: allText.includes('erro') || allText.includes('Erro')
          };
        });

        console.log(`   Has replays: ${replayPageData.hasReplays ? '✅' : '❌'}`);
        console.log(`   Has error: ${replayPageData.hasErrorMessage ? '❌' : '✅'}`);
      }
    }

    // Save full logs to file
    console.log('\n' + '='.repeat(70));
    console.log('\n📊 SUMMARY:\n');

    console.log(`Total console messages: ${logs.logs.length}`);
    console.log(`  - Errors: ${logs.errors.length}`);
    console.log(`  - Warnings: ${logs.warnings.length}`);
    console.log(`  - Logs: ${logs.logs.length}`);

    if (logs.errors.length > 0) {
      console.log(`\n❌ Errors (${logs.errors.length}):`);
      logs.errors.slice(0, 5).forEach((err, idx) => {
        console.log(`   ${idx+1}. ${err.text.substring(0, 80)}`);
      });
    }

    if (logs.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${logs.warnings.length}):`);
      logs.warnings.slice(0, 5).forEach((warn, idx) => {
        console.log(`   ${idx+1}. ${warn.text.substring(0, 80)}`);
      });
    }

    // Save to file
    const reportPath = '/opt/results/ria/r-agent2/debug-login-report.json';
    fs.writeFileSync(reportPath, JSON.stringify(logs, null, 2));
    console.log(`\n💾 Full logs saved to: ${reportPath}`);

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
