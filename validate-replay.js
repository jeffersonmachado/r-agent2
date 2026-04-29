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

    // Set timeout for all navigation
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    console.log('\n📍 Step 1: Navigate to /rpa-replays');
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log('⚠️  Navigation timeout, continuing anyway...');
    }

    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    // Check if on login page
    const loginFormExists = await page.$('input[type="text"]') !== null;
    
    if (loginFormExists) {
      console.log('\n📍 Step 2: Fill login form');
      const usernameInput = await page.$('input[type="text"]');
      const passwordInput = await page.$('input[type="password"]');

      if (usernameInput && passwordInput) {
        await usernameInput.fill('systemadmin');
        console.log('   ✅ Username filled');
        
        await passwordInput.fill('Admin123!');
        console.log('   ✅ Password filled');

        // Find and click login button
        const buttons = await page.$$('button');
        let loginBtn = null;

        for (const btn of buttons) {
          const text = await btn.innerText();
          if (text.includes('Entrar')) {
            loginBtn = btn;
            break;
          }
        }

        if (loginBtn) {
          console.log('   ✅ Login button found, clicking...');
          await loginBtn.click();

          // Wait for navigation
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
          } catch (e) {
            console.log('   ⚠️  Navigation timeout after login, checking page...');
          }

          await page.waitForTimeout(3000);
        }
      }
    }

    // Step 3: Check for replay content
    console.log('\n📍 Step 3: Waiting for replays to load');
    let replayFound = false;
    let retries = 0;

    while (!replayFound && retries < 10) {
      const pageText = await page.evaluate(() => document.body.innerText);
      
      if (pageText.includes('qa-core') || pageText.includes('qa_wave') || pageText.includes('.json')) {
        replayFound = true;
        console.log('   ✅ Replay content detected');
        break;
      }

      await page.waitForTimeout(1000);
      retries++;
    }

    if (!replayFound) {
      console.log('   ❌ No replay content found');
    }

    // Step 4: Analyze LIST mode
    console.log('\n📋 Step 4: Analyzing LIST mode');

    const listAnalysis = await page.evaluate(() => {
      const analysis = {
        mode: 'list',
        hasTable: false,
        headerColumns: [],
        targetReplayFound: false,
        targetReplayData: null,
        totalRows: 0
      };

      // Look for table
      const table = document.querySelector('table');
      if (table) {
        analysis.hasTable = true;

        // Get headers
        const headers = table.querySelectorAll('thead th');
        analysis.headerColumns = Array.from(headers).map(h => h.innerText.trim()).filter(t => t);

        // Count rows
        const rows = table.querySelectorAll('tbody tr');
        analysis.totalRows = rows.length;

        // Look for target replay
        rows.forEach(row => {
          const text = row.innerText;
          if (text.includes('qa_wave_replay_1777223461304_tmy2d4')) {
            analysis.targetReplayFound = true;
            const cells = row.querySelectorAll('td');
            analysis.targetReplayData = Array.from(cells).map(c => c.innerText.trim()).slice(0, 15);
          }
        });
      } else {
        // Try to find alternative table structure
        const gridRole = document.querySelector('[role="table"], [role="grid"]');
        if (gridRole) {
          analysis.hasTable = true;
          const text = gridRole.innerText;
          if (text.includes('qa_wave_replay_1777223461304_tmy2d4')) {
            analysis.targetReplayFound = true;
          }
        }
      }

      return analysis;
    });

    console.log(`   Table found: ${listAnalysis.hasTable ? '✅' : '❌'}`);
    if (listAnalysis.headerColumns.length > 0) {
      console.log(`   Headers (${listAnalysis.headerColumns.length}): ${listAnalysis.headerColumns.slice(0, 5).join(', ')}...`);
    }
    console.log(`   Total rows: ${listAnalysis.totalRows}`);
    console.log(`   Target replay found: ${listAnalysis.targetReplayFound ? '✅' : '❌'}`);
    if (listAnalysis.targetReplayData) {
      console.log(`   Replay data (first 5 fields): ${listAnalysis.targetReplayData.slice(0, 5).join(' | ')}`);
    }

    // Step 5: Switch to CARDS mode
    console.log('\n🎴 Step 5: Analyzing CARDS mode');

    const cardsAnalysis = await page.evaluate(() => {
      const analysis = {
        mode: 'cards',
        cardsFound: false,
        totalCards: 0,
        targetReplayFound: false,
        cardFields: [],
        targetCardContent: null
      };

      // Try to find cards
      let cards = document.querySelectorAll('[class*="card"]');
      if (cards.length === 0) {
        cards = document.querySelectorAll('[class*="Card"]');
      }
      if (cards.length === 0) {
        cards = document.querySelectorAll('article');
      }
      if (cards.length === 0) {
        // Try grid-based layout
        const gridContainer = document.querySelector('[class*="grid"]');
        if (gridContainer) {
          cards = gridContainer.querySelectorAll('> div');
        }
      }

      if (cards.length > 0) {
        analysis.cardsFound = true;
        analysis.totalCards = cards.length;

        // Look for target replay in cards
        cards.forEach(card => {
          const cardText = card.innerText;
          if (cardText.includes('qa_wave_replay_1777223461304_tmy2d4')) {
            analysis.targetReplayFound = true;
            analysis.targetCardContent = cardText.substring(0, 400);
          }
        });

        // Extract field labels from first card
        if (cards.length > 0) {
          const firstCard = cards[0];
          const fieldElements = firstCard.querySelectorAll('[class*="label"], strong, b, [class*="text-sm"]');
          const fields = new Set();

          fieldElements.forEach(elem => {
            const text = elem.innerText.trim();
            if (text && text.length > 0 && text.length < 100) {
              fields.add(text);
            }
          });

          analysis.cardFields = Array.from(fields).slice(0, 10);
        }
      }

      return analysis;
    });

    console.log(`   Cards found: ${cardsAnalysis.cardsFound ? '✅' : '❌'}`);
    console.log(`   Total cards: ${cardsAnalysis.totalCards}`);
    console.log(`   Target replay found: ${cardsAnalysis.targetReplayFound ? '✅' : '❌'}`);
    if (cardsAnalysis.cardFields.length > 0) {
      console.log(`   Fields in cards: ${cardsAnalysis.cardFields.slice(0, 5).join(', ')}...`);
    }
    if (cardsAnalysis.targetCardContent) {
      console.log(`   Card content preview: ${cardsAnalysis.targetCardContent.substring(0, 200)}...`);
    }

    // Step 6: Final Report
    console.log('\n' + '='.repeat(70));
    console.log('VALIDATION REPORT');
    console.log('='.repeat(70));

    const results = {
      url: currentUrl,
      listMode: {
        status: listAnalysis.targetReplayFound ? '✅ PASS' : '❌ FAIL',
        tableFound: listAnalysis.hasTable,
        replayFound: listAnalysis.targetReplayFound,
        columnCount: listAnalysis.headerColumns.length,
        rowCount: listAnalysis.totalRows
      },
      cardsMode: {
        status: cardsAnalysis.targetReplayFound ? '✅ PASS' : '❌ FAIL',
        cardsFound: cardsAnalysis.cardsFound,
        replayFound: cardsAnalysis.targetReplayFound,
        totalCards: cardsAnalysis.totalCards,
        fieldCount: cardsAnalysis.cardFields.length
      }
    };

    console.log('\n📋 LIST Mode:');
    console.log(`   Status: ${results.listMode.status}`);
    console.log(`   Table found: ${results.listMode.tableFound}`);
    console.log(`   Replay found: ${results.listMode.replayFound}`);
    console.log(`   Columns: ${results.listMode.columnCount}`);
    console.log(`   Rows: ${results.listMode.rowCount}`);

    console.log('\n🎴 CARDS Mode:');
    console.log(`   Status: ${results.cardsMode.status}`);
    console.log(`   Cards found: ${results.cardsMode.cardsFound}`);
    console.log(`   Replay found: ${results.cardsMode.replayFound}`);
    console.log(`   Total cards: ${results.cardsMode.totalCards}`);
    console.log(`   Fields per card: ${results.cardsMode.fieldCount}`);

    console.log('\n' + '='.repeat(70));
    
    if (results.listMode.replayFound && results.cardsMode.replayFound) {
      console.log('✅ OVERALL: Replay visible in BOTH modes!');
      process.exit(0);
    } else if (results.listMode.replayFound || results.cardsMode.replayFound) {
      console.log('⚠️  OVERALL: Replay visible in ONE mode only');
      process.exit(1);
    } else {
      console.log('❌ OVERALL: Replay NOT visible in either mode');
      process.exit(2);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(3);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
