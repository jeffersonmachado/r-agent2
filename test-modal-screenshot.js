const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-gpu']});
    const page = await browser.newPage();
    
    // Login
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
    await page.waitForTimeout(3000);

    // Screenshot
    const screenshotPath = path.join(__dirname, 'modal-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    
    console.log(`Screenshot saved: ${screenshotPath}`);
    
  } finally {
    if (browser) await browser.close();
  }
})();
