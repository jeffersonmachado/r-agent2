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
    
    console.log('\n🔍 LOGIN PAGE STRUCTURE\n');
    console.log('='.repeat(70));

    console.log('\n1️⃣ Navigate to home');
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    const pageInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const inputs = document.querySelectorAll('input');
      const buttons = document.querySelectorAll('button');

      return {
        title: document.title,
        bodyPreview: text.substring(0, 300),
        inputs: Array.from(inputs).map((inp, idx) => ({
          idx,
          type: inp.type,
          placeholder: inp.placeholder,
          id: inp.id,
          name: inp.name
        })),
        buttons: Array.from(buttons).map((btn, idx) => ({
          idx,
          text: btn.innerText,
          id: btn.id,
          className: btn.className
        })),
        allText: text
      };
    });

    console.log(`\n2️⃣ Page Structure:`);
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   Body preview: ${pageInfo.bodyPreview}`);
    
    console.log(`\n   Inputs (${pageInfo.inputs.length}):`);
    pageInfo.inputs.forEach(inp => {
      console.log(`     [${inp.idx}] type=${inp.type}, placeholder="${inp.placeholder}", id="${inp.id}"`);
    });

    console.log(`\n   Buttons (${pageInfo.buttons.length}):`);
    pageInfo.buttons.slice(0, 10).forEach(btn => {
      console.log(`     [${btn.idx}] "${btn.text}" (id="${btn.id}")`);
    });

    // Look for login-related content
    console.log(`\n3️⃣ Login-related content:`);
    if (pageInfo.allText.includes('login') || pageInfo.allText.includes('agente')) {
      console.log('   ✅ Login page detected');
    } else if (pageInfo.allText.includes('Replays') || pageInfo.allText.includes('dashboard')) {
      console.log('   ⚠️  Already logged in? (found dashboard content)');
    } else {
      console.log('   ❓ Unknown page state');
    }

    // Show all text to identify the page
    console.log(`\n4️⃣ All page text (first 1000 chars):`);
    console.log(`\n${pageInfo.allText.substring(0, 1000)}\n`);

    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
