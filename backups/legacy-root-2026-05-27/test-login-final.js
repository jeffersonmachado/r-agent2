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
    
    console.log('\n🔐 FINAL LOGIN TEST\n');
    console.log('='.repeat(70));

    // Navigate to login
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });

    // Fill and submit
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

    // Wait for response
    await page.waitForTimeout(2500);

    // Check EXACT state
    const finalState = await page.evaluate(() => {
      const token = localStorage.getItem('auth_token');
      const agent = localStorage.getItem('auth_agent');
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        keys.push(localStorage.key(i));
      }
      return {
        token: token,
        tokenLength: token ? token.length : 0,
        agent: agent ? JSON.parse(agent) : null,
        keys: keys,
        url: window.location.href,
        pathname: window.location.pathname,
      };
    });

    console.log('\n📊 FINAL STATE:');
    console.log(`   Token: ${finalState.token ? '✅ SAVED' : '❌ MISSING'}`);
    if (finalState.token) {
      console.log(`   Token value: ${finalState.token.substring(0, 40)}...`);
      console.log(`   Token length: ${finalState.tokenLength}`);
    }
    console.log(`   Agent: ${finalState.agent ? '✅ SAVED' : '❌ MISSING'}`);
    if (finalState.agent) {
      console.log(`   Agent user: ${finalState.agent.username} (${finalState.agent.role})`);
    }
    console.log(`   URL: ${finalState.url}`);
    console.log(`   Pathname: ${finalState.pathname}`);
    console.log(`   LocalStorage keys: ${finalState.keys.join(', ')}`);

    if (finalState.token && finalState.agent) {
      console.log('\n✅ SUCCESS! Login complete:');
      console.log('   - Token saved');
      console.log('   - Agent info saved');
      console.log('   - Modal/Tenant selection showing (expected for super-admin)');
    } else {
      console.log('\n❌ Issue: Token or agent not saved!');
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
