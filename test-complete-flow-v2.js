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
    
    console.log('\n✅ COMPLETE FLOW V2\n');
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
    await page.waitForTimeout(2500);

    // Find and inspect modal elements
    console.log('\n2️⃣ Analyzing tenant modal...');
    
    const modalInfo = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return { found: false };
      
      const selectable = modal.querySelectorAll('[class*="card"], div[role="button"], [class*="option"]');
      
      return {
        found: true,
        selectableCount: selectable.length,
        options: Array.from(selectable)
          .map((el, i) => ({
            index: i,
            text: el.innerText.substring(0, 50),
            role: el.getAttribute('role'),
            clickable: el.offsetParent !== null,
          }))
          .slice(0, 5),
      };
    });

    console.log(`   Modal found: ${modalInfo.found ? '✅' : '❌'}`);
    console.log(`   Selectable elements: ${modalInfo.selectableCount}`);
    
    if (modalInfo.options.length > 0) {
      console.log('   Options found:');
      modalInfo.options.forEach(opt => {
        console.log(`      [${opt.index}] ${opt.text} (clickable: ${opt.clickable})`);
      });
    }

    // Try clicking first selectable element (System tenant)
    console.log('\n3️⃣ Selecting first tenant...');
    
    try {
      const firstTenant = await page.$('[role="dialog"] [class*="card"], [role="dialog"] [class*="option"], [role="dialog"] > div > div > div > div');
      if (firstTenant) {
        await firstTenant.click();
        console.log('   ✅ Tenant option clicked');
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log(`   ⚠️  Click error: ${e.message}`);
    }

    // Try different approach - click any div that contains "System" text
    console.log('\n4️⃣ Looking for System tenant...');
    const foundSystem = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        if (el.innerText && el.innerText.includes('System') && 
            el.getAttribute('role') !== 'dialog' &&
            el.offsetParent !== null) {
          return {
            found: true,
            text: el.innerText.substring(0, 80),
            tagName: el.tagName,
          };
        }
      }
      return { found: false };
    });
    
    if (foundSystem.found) {
      console.log(`   ✅ Found: ${foundSystem.tagName} containing "System"`);
      console.log(`   Text: ${foundSystem.text}`);
      
      // Try clicking it via text
      await page.click('text=System');
      console.log('   ✅ Clicked');
      await page.waitForTimeout(800);
    }

    // Click Acessar button (if enabled)
    console.log('\n5️⃣ Looking for "Acessar" button...');
    
    try {
      // Try direct text click
      await page.click('text=Acessar', { timeout: 3000 });
      console.log('   ✅ Acessar clicked');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`   ⚠️  Could not click Acessar: ${e.message}`);
    }

    // Check final state
    console.log('\n6️⃣ Final state:');
    
    const finalState = await page.evaluate(() => ({
      url: window.location.href,
      pathname: window.location.pathname,
      hasTable: !!document.querySelector('table'),
      rows: document.querySelectorAll('table tbody tr').length,
    }));

    console.log(`   URL: ${finalState.url}`);
    console.log(`   Pathname: ${finalState.pathname}`);
    console.log(`   Has table: ${finalState.hasTable ? '✅' : '❌'}`);
    console.log(`   Rows: ${finalState.rows}`);

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
