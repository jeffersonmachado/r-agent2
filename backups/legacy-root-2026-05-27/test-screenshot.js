#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    
    console.log('\n📸 TAKING SCREENSHOT\n');
    console.log('='.repeat(70));

    // Login
    console.log('Logging in...');
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

    // Navigate to replays
    console.log('Loading RPA Replays page...');
    await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Set viewport for better screenshot
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(500);

    // Take screenshot
    const screenshotPath = path.join(__dirname, 'rpa-replays-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    console.log(`\n✅ Screenshot saved: ${screenshotPath}`);
    
    // Get page dimensions
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    
    console.log(`\nPage dimensions:`);
    console.log(`   Viewport: ${dimensions.width}x${dimensions.height}`);
    console.log(`   Document: ${dimensions.scrollWidth}x${dimensions.scrollHeight}`);

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
