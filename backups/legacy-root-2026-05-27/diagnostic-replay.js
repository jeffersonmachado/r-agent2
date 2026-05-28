#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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

    // Capture console errors
    const consoleMessages = [];
    const pageErrors = [];
    
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        args: msg.args().length
      });
    });

    page.on('pageerror', err => {
      pageErrors.push({
        message: err.message,
        stack: err.stack?.substring(0, 200)
      });
    });

    console.log('\n🔍 DIAGNOSTIC: Replay qa_wave_replay_1777223461305_6j29m9\n');
    console.log('='.repeat(70));

    // Navigate to /rpa-replays
    console.log('\n1️⃣ Navigate & Login');
    try {
      await page.goto('http://127.0.0.1:5173/rpa-replays', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      // ignore
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
        // ignore
      }
      await page.waitForTimeout(3000);
    }

    console.log('   ✅ Login successful');

    // Get API response for the specific replay
    console.log('\n2️⃣ Fetch API data for replay');
    
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch('/api/test-executions/replays?limit=200');
      const data = await response.json();
      // Handle both array and object responses
      if (Array.isArray(data)) {
        return data;
      } else if (data && typeof data === 'object') {
        // If it's an object with a data/replays field, extract it
        return data.replays || data.data || [data];
      }
      return [];
    });

    console.log(`   ✅ API returned ${Array.isArray(apiResponse) ? apiResponse.length : 'invalid'} replays`);

    // Find the specific replay in API response
    const targetReplay = Array.isArray(apiResponse) 
      ? apiResponse.find(r => 
          r.id === 'qa_wave_replay_1777223461305_6j29m9' || 
          r.replayId === 'qa_wave_replay_1777223461305_6j29m9' ||
          r.filename === 'qa_wave_replay_1777223461305_6j29m9.json'
        )
      : null;

    console.log('\n3️⃣ API Data for target replay:');
    if (targetReplay) {
      console.log('   ✅ Found in API response');
      console.log('\n   Full object:');
      console.log(JSON.stringify(targetReplay, null, 2).substring(0, 1000));
    } else {
      console.log('   ❌ NOT found in API response');
      if (Array.isArray(apiResponse)) {
        console.log('\n   Replays in API (first 5):');
        apiResponse.slice(0, 5).forEach((r, idx) => {
          console.log(`     ${idx+1}. ${r.filename || r.replayId || r.id}`);
        });
      } else {
        console.log('\n   ⚠️  API response is not array:', typeof apiResponse);
        console.log('   Response:', JSON.stringify(apiResponse).substring(0, 200));
      }
    }

    // Get table/card data from page
    console.log('\n4️⃣ UI Display Data:');

    const uiData = await page.evaluate(() => {
      const TARGET_REPLAY = 'qa_wave_replay_1777223461305_6j29m9';
      
      const result = {
        found: false,
        uiData: null,
        allReplayNames: [],
        errors: [],
        warnings: []
      };

      const allText = document.body.innerText;
      result.found = allText.includes(TARGET_REPLAY);

      // Find table rows
      const table = document.querySelector('table');
      if (table) {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const rowText = row.innerText;
          
          if (rowText.includes(TARGET_REPLAY)) {
            result.uiData = {
              cells: Array.from(cells).map(c => c.innerText.trim()),
              rawText: rowText.substring(0, 500)
            };
          }

          // Collect all replay names for comparison
          if (cells.length > 1) {
            const filename = cells[1]?.innerText;
            if (filename && filename.includes('.json')) {
              result.allReplayNames.push(filename);
            }
          }
        });
      }

      // Look for error messages or warnings
      const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]');
      errorElements.forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 5) {
          result.errors.push(text.substring(0, 100));
        }
      });

      return result;
    });

    console.log(`   Replay found in UI: ${uiData.found ? '✅' : '❌'}`);
    
    if (uiData.uiData) {
      console.log('\n   UI Row Cells (first 8):');
      uiData.uiData.cells.slice(0, 8).forEach((cell, idx) => {
        console.log(`     ${idx+1}. ${cell.substring(0, 60)}`);
      });
    } else {
      console.log('   ⚠️  Row data not found in UI');
      console.log('\n   Available replays in table (first 5):');
      uiData.allReplayNames.slice(0, 5).forEach((name, idx) => {
        console.log(`     ${idx+1}. ${name}`);
      });
    }

    if (uiData.errors.length > 0) {
      console.log('\n   ❌ Error messages on page:');
      uiData.errors.forEach(err => console.log(`     - ${err}`));
    } else {
      console.log('   ✅ No error messages on page');
    }

    // Check network errors
    console.log('\n5️⃣ Browser Console Analysis:');
    console.log(`   Total console messages: ${consoleMessages.length}`);
    
    const errors = consoleMessages.filter(m => m.type === 'error');
    const warnings = consoleMessages.filter(m => m.type === 'warning');
    
    console.log(`   Errors: ${errors.length}`);
    console.log(`   Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log('\n   Error details:');
      errors.slice(0, 5).forEach((err, idx) => {
        console.log(`     ${idx+1}. ${err.text.substring(0, 80)}`);
      });
    }

    if (pageErrors.length > 0) {
      console.log('\n   Page errors:');
      pageErrors.slice(0, 3).forEach((err, idx) => {
        console.log(`     ${idx+1}. ${err.message.substring(0, 80)}`);
      });
    }

    // Compare API vs UI
    console.log('\n6️⃣ Comparison: API vs UI');
    if (targetReplay && uiData.uiData) {
      console.log('   ✅ Both found, comparing fields:');
      
      const apiFields = Object.keys(targetReplay);
      const uiCells = uiData.uiData.cells;

      console.log(`\n   API fields (${apiFields.length}):`);
      apiFields.slice(0, 10).forEach(f => console.log(`     - ${f}`));

      console.log(`\n   UI cells (${uiCells.length}):`);
      uiCells.slice(0, 10).forEach((c, idx) => console.log(`     ${idx+1}. ${c.substring(0, 40)}`));
    } else if (targetReplay && !uiData.uiData) {
      console.log('   ❌ API has data but UI row not found');
    } else if (!targetReplay && uiData.found) {
      console.log('   ❌ Text found in UI but not in API data structure');
    } else {
      console.log('   ❌ Replay not found in either API or UI');
    }

    // Check raw file system
    console.log('\n7️⃣ File System Check:');
    const rpaReplayDir = '/opt/results/ria/r-agent2/rpa/replay';
    const qaReplayDir = '/opt/results/ria/r-agent2/qa-mesh/meshEvidence';

    try {
      const rpaFiles = fs.readdirSync(rpaReplayDir).filter(f => f.includes('6j29m9'));
      console.log(`   RPA replay dir (${rpaReplayDir}): ${rpaFiles.length} matches`);
      rpaFiles.forEach(f => console.log(`     - ${f}`));
    } catch (e) {
      console.log(`   ⚠️  RPA dir check failed: ${e.message}`);
    }

    try {
      const qaDir = fs.readdirSync(qaReplayDir);
      console.log(`   QA Mesh dir (${qaReplayDir}): ${qaDir.length} entries`);
    } catch (e) {
      console.log(`   ⚠️  QA dir check failed: ${e.message}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n📊 SUMMARY:\n');
    
    const summary = {
      apiHasReplay: !!targetReplay,
      uiShowsReplay: uiData.found,
      browserErrors: errors.length + pageErrors.length,
      pageHasErrorMessages: uiData.errors.length > 0
    };

    console.log(`   API has replay:           ${summary.apiHasReplay ? '✅' : '❌'}`);
    console.log(`   UI displays replay:       ${summary.uiShowsReplay ? '✅' : '❌'}`);
    console.log(`   Browser console errors:  ${summary.browserErrors} ${summary.browserErrors > 0 ? '❌' : '✅'}`);
    console.log(`   Page error messages:     ${summary.pageHasErrorMessages ? '❌' : '✅'}`);

    process.exit(
      summary.apiHasReplay && summary.uiShowsReplay && summary.browserErrors === 0 
        ? 0 
        : 1
    );

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(2);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
