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
    
    console.log('\n⚛️ REACT STATE CHECK\n');
    console.log('='.repeat(70));

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
    await page.waitForTimeout(2000);

    // Go to replays page
    await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // Inject debugging script
    console.log('\n1️⃣ Injecting debug script...');
    
    const debugInfo = await page.evaluate(() => {
      // Try to access React fiber/state through various methods
      const bodyElement = document.querySelector('[data-reactroot], [data-react-root], body > div');
      
      // Look for error boundaries or state info
      const errorTexts = Array.from(document.querySelectorAll('*'))
        .filter(el => 
          el.innerText && 
          (el.innerText.includes('Error') || 
           el.innerText.includes('erro') ||
           el.innerText.includes('loading') ||
           el.innerText.includes('carregando'))
        )
        .map(el => el.innerText.substring(0, 100))
        .slice(0, 5);

      // Look for data attributes
      const replayContainer = document.querySelector('[class*="replay"], [id*="replay"]');
      
      return {
        hasRoot: !!bodyElement,
        rootClass: bodyElement ? bodyElement.className : 'none',
        errorMessages: errorTexts,
        hasReplayContainer: !!replayContainer,
        replayContainerClass: replayContainer ? replayContainer.className : 'none',
        totalElements: document.querySelectorAll('*').length,
        visibleText: document.body.innerText.substring(0, 500),
      };
    });

    console.log(`   Root element found: ${debugInfo.hasRoot ? '✅' : '❌'}`);
    console.log(`   Root class: ${debugInfo.rootClass}`);
    console.log(`   Error messages: ${debugInfo.errorMessages.length}`);
    if (debugInfo.errorMessages.length > 0) {
      debugInfo.errorMessages.forEach(msg => {
        console.log(`      - ${msg}`);
      });
    }

    // Check for specific error indicators
    console.log('\n2️⃣ Searching for error indicators...');
    
    const hasError = await page.evaluate(() => {
      const searchTerms = [
        'Erro ao carregar',
        'error loading',
        'falha',
        'fail',
        'undefined',
        'null',
        'TypeError',
        'Cannot read'
      ];

      const pageText = document.body.innerText.toLowerCase();
      const foundTerms = searchTerms.filter(term => pageText.includes(term.toLowerCase()));
      
      return {
        hasErrors: foundTerms.length > 0,
        foundTerms: foundTerms,
        pageLength: document.body.innerText.length,
      };
    });

    console.log(`   Found error indicators: ${hasError.hasErrors ? '✅' : '❌'}`);
    if (hasError.foundTerms.length > 0) {
      console.log(`   Terms found: ${hasError.foundTerms.join(', ')}`);
    }
    console.log(`   Page text length: ${hasError.pageLength}`);

    // Check for modal/dialogs
    console.log('\n3️⃣ Checking for modals/dialogs...');
    
    const modals = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"], .modal, [class*="Modal"]');
      const toasts = document.querySelectorAll('[role="alert"], [class*="toast"], [class*="Toast"]');
      
      return {
        dialogs: dialogs.length,
        toasts: toasts.length,
        dialogTexts: Array.from(dialogs).map(d => d.innerText.substring(0, 50)).slice(0, 3),
        toastTexts: Array.from(toasts).map(t => t.innerText.substring(0, 50)).slice(0, 3),
      };
    });

    console.log(`   Dialogs: ${modals.dialogs}`);
    console.log(`   Toasts: ${modals.toasts}`);
    if (modals.dialogTexts.length > 0) {
      console.log(`   Dialog texts: ${modals.dialogTexts.join(' | ')}`);
    }

    console.log('\n' + '='.repeat(70));
    
    console.log('\n📋 Visible page content (first 400 chars):');
    console.log('   ' + debugInfo.visibleText.split('\n').slice(0, 8).join('\n   '));

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
