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

    console.log('\n🚀 VALIDATION TEST: qa_wave_replay_1777223461304_tmy2d4\n');
    console.log('='.repeat(70));

    // Navigate
    console.log('\n1️⃣ SETUP: Navigate to /rpa-replays');
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      // Ignore timeout
    }
    await page.waitForTimeout(2000);

    // Login
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
        // Ignore
      }
      await page.waitForTimeout(3000);
    }

    console.log('   ✅ Login successful, page loaded');

    // CARDS MODE TEST
    console.log('\n2️⃣ TEST MODE: CARDS (🗂️ Grid Layout)\n');

    // Make sure we're in cards mode
    const switchedToCards = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = btn.innerText;
        if (text.includes('Cards') || text.includes('🗂️')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (switchedToCards) {
      console.log('   Switched to CARDS mode');
    }

    await page.waitForTimeout(2000);

    const cardsData = await page.evaluate(() => {
      const TARGET_REPLAY = 'qa_wave_replay_1777223461304_tmy2d4';
      const allText = document.body.innerText;

      const result = {
        replayFound: allText.includes(TARGET_REPLAY),
        cards: [],
        allReplayNames: [],
        pageIndicator: null
      };

      // Find all replays mentioned on page
      const lines = allText.split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if ((trimmed.includes('.json') || trimmed.includes('replay')) && trimmed.length > 10 && trimmed.length < 200) {
          result.allReplayNames.push(trimmed);
        }
      });

      // Find page indicator
      const pageIndicatorLine = lines.find(l => l.includes('Exibindo'));
      if (pageIndicatorLine) {
        result.pageIndicator = pageIndicatorLine.trim();
      }

      // Find cards
      let cardElements = document.querySelectorAll('[class*="card"]');
      if (cardElements.length === 0) {
        cardElements = document.querySelectorAll('[class*="Card"]');
      }

      Array.from(cardElements).slice(0, 10).forEach((card, idx) => {
        const cardText = card.innerText;
        if (cardText && cardText.length > 50) {
          result.cards.push({
            index: idx,
            content: cardText.substring(0, 400),
            isTarget: cardText.includes(TARGET_REPLAY)
          });
        }
      });

      return result;
    });

    console.log(`   Page indicator: ${cardsData.pageIndicator}`);
    console.log(`   Target replay found: ${cardsData.replayFound ? '✅ YES' : '❌ NO'}`);
    console.log(`   Total cards displayed: ${cardsData.cards.length}`);

    let targetCardFound = false;
    cardsData.cards.forEach(card => {
      if (card.isTarget) {
        console.log(`\n   ✅ TARGET CARD FOUND (#${card.index + 1}):`);
        console.log(`   Content preview:`);
        card.content.split('\n').slice(0, 8).forEach(line => {
          if (line.trim()) {
            console.log(`     ${line.substring(0, 60)}`);
          }
        });
        targetCardFound = true;
      }
    });

    if (!targetCardFound && cardsData.cards.length > 0) {
      console.log(`\n   Other replays visible (first 3 cards):`);
      cardsData.cards.slice(0, 3).forEach((card, idx) => {
        const firstLine = card.content.split('\n')[0];
        console.log(`     Card ${idx + 1}: ${firstLine.substring(0, 50)}`);
      });
    }

    // LIST MODE TEST
    console.log('\n3️⃣ TEST MODE: LIST (📄 Table)\n');

    const switchedToList = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = btn.innerText;
        if (text.includes('Lista') || text.includes('📄')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (switchedToList) {
      console.log('   Switched to LIST mode');
    }

    await page.waitForTimeout(2000);

    const listData = await page.evaluate(() => {
      const TARGET_REPLAY = 'qa_wave_replay_1777223461304_tmy2d4';
      const allText = document.body.innerText;

      const result = {
        replayFound: allText.includes(TARGET_REPLAY),
        tableFound: !!document.querySelector('table'),
        columnHeaders: [],
        targetRow: null,
        totalRows: 0,
        pageIndicator: null
      };

      // Find page indicator
      const lines = allText.split('\n');
      const pageIndicatorLine = lines.find(l => l.includes('Exibindo'));
      if (pageIndicatorLine) {
        result.pageIndicator = pageIndicatorLine.trim();
      }

      const table = document.querySelector('table');
      if (table) {
        // Get headers
        const headers = table.querySelectorAll('thead th');
        result.columnHeaders = Array.from(headers).map(h => h.innerText.trim()).filter(t => t);

        // Count rows
        const rows = table.querySelectorAll('tbody tr');
        result.totalRows = rows.length;

        // Find target replay row
        rows.forEach(row => {
          const rowText = row.innerText;
          if (rowText.includes(TARGET_REPLAY)) {
            const cells = row.querySelectorAll('td');
            result.targetRow = {
              text: rowText.substring(0, 300),
              cellCount: cells.length,
              firstCells: Array.from(cells).slice(0, 5).map(c => c.innerText.trim().substring(0, 50))
            };
          }
        });
      }

      return result;
    });

    console.log(`   Page indicator: ${listData.pageIndicator}`);
    console.log(`   Target replay found: ${listData.replayFound ? '✅ YES' : '❌ NO'}`);
    console.log(`   Table found: ${listData.tableFound ? '✅ YES' : '❌ NO'}`);
    console.log(`   Total rows: ${listData.totalRows}`);
    console.log(`   Column headers (${listData.columnHeaders.length}):`);
    listData.columnHeaders.forEach((header, idx) => {
      console.log(`     ${idx + 1}. ${header}`);
    });

    if (listData.targetRow) {
      console.log(`\n   ✅ TARGET ROW FOUND:`);
      console.log(`   First 5 cells:`);
      listData.targetRow.firstCells.forEach((cell, idx) => {
        console.log(`     ${idx + 1}. ${cell}`);
      });
    }

    // FINAL REPORT
    console.log('\n' + '='.repeat(70));
    console.log('\n📊 FINAL VALIDATION REPORT\n');

    const cardsStatus = cardsData.replayFound ? '✅ VISIBLE' : '❌ NOT FOUND';
    const listStatus = listData.replayFound ? '✅ VISIBLE' : '❌ NOT FOUND';

    console.log(`   CARDS Mode:  ${cardsStatus}`);
    console.log(`   LIST Mode:   ${listStatus}`);

    if (cardsData.replayFound && listData.replayFound) {
      console.log('\n   🎉 SUCCESS: Replay is visible in BOTH modes!');
      console.log(`\n   Replay: qa_wave_replay_1777223461304_tmy2d4`);
      console.log(`   Card display: ${cardsData.cards.length} cards shown`);
      console.log(`   List display: ${listData.totalRows} rows shown`);
      console.log(`   Columns in table: ${listData.columnHeaders.length}`);
      process.exit(0);
    } else if (cardsData.replayFound || listData.replayFound) {
      console.log('\n   ⚠️  PARTIAL: Replay visible in one mode only');
      process.exit(1);
    } else {
      console.log('\n   ❌ FAIL: Replay not visible in either mode');
      process.exit(2);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(3);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
