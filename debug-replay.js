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
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    console.log('\n📍 Navigate to /rpa-replays');
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log('⚠️  Navigation timeout');
    }

    await page.waitForTimeout(2000);

    // Login
    console.log('\n📍 Login...');
    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill('systemadmin');
      await passwordInput.fill('Admin123!');

      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.innerText();
        if (text.includes('Entrar')) {
          await btn.click();
          break;
        }
      }

      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (e) {
        console.log('⚠️  Navigation timeout after login');
      }

      await page.waitForTimeout(3000);
    }

    // Get detailed page structure
    console.log('\n📍 Analyzing page structure...');

    const pageData = await page.evaluate(() => {
      const data = {
        currentUrl: window.location.href,
        title: document.title,
        pageText: document.body.innerText.substring(0, 1000),
        hasTable: !!document.querySelector('table'),
        hasDisplayModeButtons: false,
        displayModeButtons: [],
        allCards: [],
        allCardsByClass: [],
        replayFilenames: [],
        allText: document.body.innerText
      };

      // Look for display mode buttons (List/Cards toggle)
      const buttons = document.querySelectorAll('button');
      buttons.forEach(btn => {
        const text = btn.innerText;
        if (text.includes('List') || text.includes('list') || text.includes('Cards') || text.includes('cards') || text.includes('🎴') || text.includes('📋')) {
          data.displayModeButtons.push(text.trim());
          data.hasDisplayModeButtons = true;
        }
      });

      // Find all card-like elements
      const cardSelectors = [
        '[class*="card"]',
        '[class*="Card"]',
        'article',
        '[role="article"]'
      ];

      let allCardsFound = [];

      cardSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          Array.from(elements).forEach(el => {
            const text = el.innerText || el.textContent;
            if (text && text.length > 20) {
              allCardsFound.push({
                selector: selector,
                text: text.substring(0, 300),
                html: el.outerHTML.substring(0, 500)
              });
            }
          });
        }
      });

      data.allCards = allCardsFound.slice(0, 10);

      // Extract all filenames that look like replays
      const allText = document.body.innerText;
      const lines = allText.split('\n');
      lines.forEach(line => {
        if (line.includes('.json') || line.includes('qa_wave') || line.includes('replay')) {
          const trimmed = line.trim();
          if (trimmed.length > 5 && trimmed.length < 200) {
            data.replayFilenames.push(trimmed.substring(0, 100));
          }
        }
      });

      // Check for specific replay
      data.hasTargetReplay = allText.includes('qa_wave_replay_1777223461304_tmy2d4');

      return data;
    });

    console.log(`\n📄 Page Structure:`);
    console.log(`   URL: ${pageData.currentUrl}`);
    console.log(`   Has table: ${pageData.hasTable}`);
    console.log(`   Has display mode buttons: ${pageData.hasDisplayModeButtons}`);
    console.log(`   Display buttons: ${pageData.displayModeButtons.join(', ')}`);
    console.log(`   Cards found: ${pageData.allCards.length}`);
    console.log(`   Target replay on page: ${pageData.hasTargetReplay ? '✅' : '❌'}`);

    console.log(`\n📋 Replay filenames detected:`);
    pageData.replayFilenames.slice(0, 10).forEach((name, idx) => {
      console.log(`   ${idx + 1}. ${name}`);
    });

    if (pageData.allCards.length > 0) {
      console.log(`\n📊 Card content (first 3):`);
      pageData.allCards.slice(0, 3).forEach((card, idx) => {
        console.log(`\n   Card ${idx + 1}:`);
        console.log(`   Text: ${card.text.substring(0, 150)}`);
      });
    }

    // Try to scroll and load more replays
    console.log('\n📍 Scrolling to load more replays...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(2000);

    // Check again after scroll
    const afterScrollData = await page.evaluate(() => {
      const allText = document.body.innerText;
      return {
        hasTargetReplay: allText.includes('qa_wave_replay_1777223461304_tmy2d4'),
        cardCount: document.querySelectorAll('[class*="card"]').length + 
                   document.querySelectorAll('[class*="Card"]').length +
                   document.querySelectorAll('article').length
      };
    });

    console.log(`   Cards after scroll: ${afterScrollData.cardCount}`);
    console.log(`   Target replay found: ${afterScrollData.hasTargetReplay ? '✅' : '❌'}`);

    // Try clicking LIST mode if available
    console.log('\n📍 Checking LIST mode...');
    const listModeFound = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = btn.innerText;
        if ((text.includes('List') || text.includes('list') || text.includes('📋')) && !text.includes('Card')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (listModeFound) {
      console.log('   ✅ LIST button clicked');
      await page.waitForTimeout(2000);

      const listData = await page.evaluate(() => {
        const allText = document.body.innerText;
        return {
          hasTargetReplay: allText.includes('qa_wave_replay_1777223461304_tmy2d4'),
          hasTable: !!document.querySelector('table'),
          rowCount: document.querySelectorAll('tr').length,
          allText: allText.substring(0, 500)
        };
      });

      console.log(`   Has table: ${listData.hasTable}`);
      console.log(`   Rows: ${listData.rowCount}`);
      console.log(`   Target replay found: ${listData.hasTargetReplay ? '✅' : '❌'}`);
      console.log(`   Text preview: ${listData.allText}`);
    } else {
      console.log('   ❌ LIST button not found or not clicked');
    }

    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
