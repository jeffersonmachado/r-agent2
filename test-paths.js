#!/usr/bin/env node

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  console.log('\nTesting navigation to different paths...\n');
  console.log('='.repeat(70));
  
  const paths = ['/', '/dev', '/app', '/login', '/dev/rpa-replays'];
  
  for (const path of paths) {
    try {
      await page.goto('http://127.0.0.1:5173' + path, { waitUntil: 'domcontentloaded', timeout: 5000 });
      await page.waitForTimeout(500);
      
      const url = page.url();
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText.substring(0, 100));
      const inputs = await page.$$('input[type="text"], input[type="password"]');
      
      console.log(`📍 ${path}:`);
      console.log(`   URL: ${url}`);
      console.log(`   Title: ${title}`);
      console.log(`   Text: ${text.split('\n')[0]}`);
      console.log(`   Login inputs: ${inputs.length} ${inputs.length > 0 ? '✅' : ''}`);
      console.log();
    } catch (e) {
      console.log(`📍 ${path}: ❌ Error\n`);
    }
  }
  
  console.log('='.repeat(70));
  await browser.close();
})();
