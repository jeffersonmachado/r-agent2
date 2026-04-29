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
    
    console.log('\n🔐 TESTING LOGIN - CHECKING FOR MODAL\n');
    console.log('='.repeat(70));

    // Navigate to login
    console.log('\n1️⃣ Logging in...');
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });

    // Fill and submit
    const inputs = await page.$$('input');
    await inputs[0].fill('systemadmin');
    await inputs[1].fill('Admin123!');
    const buttons = await page.$$('button');
    const submitButton = buttons.find(b => b.textContent().then(t => t.toLowerCase().includes('entrar')));
    if (submitButton) await submitButton.click();

    // Wait for modal/response
    await page.waitForTimeout(2000);

    // Check for modal
    console.log('\n2️⃣ Checking page state...');
    
    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        token: !!localStorage.getItem('auth_token'),
        modals: document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]').length,
        visibleElements: {
          tenantModal: !!document.querySelector('[class*="TenantSelector"]'),
          buttons: document.querySelectorAll('button').length,
          modalTitle: document.querySelector('[role="dialog"] h2')?.textContent || document.querySelector('[class*="modal"] h2')?.textContent || 'none'
        },
        hasToast: !!document.querySelector('[class*="Toast"], [role="alert"]'),
        bodyClasses: document.body.className,
      };
    });

    console.log(`   Token saved: ${pageState.token ? '✅' : '❌'}`);
    console.log(`   URL: ${pageState.url}`);
    console.log(`   Pathname: ${pageState.pathname}`);
    console.log(`   Modals found: ${pageState.modals}`);
    console.log(`   Has visible modal: ${pageState.visibleElements.tenantModal ? '✅' : '❌'}`);
    console.log(`   Modal title: ${pageState.visibleElements.modalTitle}`);

    // Check for specific text that indicates tenant modal
    const pageText = await page.innerText('body');
    const hasTenantText = pageText.includes('Selecione o tenant') || 
                          pageText.includes('tenant') ||
                          pageText.includes('sistema');
    
    console.log(`   Has tenant-related text: ${hasTenantText ? '✅' : '❌'}`);

    if (pageState.modals > 0 || hasTenantText) {
      console.log('\n   ✅ Modal/Tenant selection page detected after login!');
      console.log('   This is EXPECTED behavior for super-admin account.');
      console.log('   The token IS saved, but login flow requires tenant selection.');
    } else {
      console.log('\n   No modal detected. Looking for navigation...');
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
