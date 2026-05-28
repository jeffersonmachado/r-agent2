#!/usr/bin/env node

const { chromium } = require('playwright');
const { loginWithTenantSelection } = require('./tests/helpers/playwrightAuth');

const BASE_URL = 'http://127.0.0.1:5173/dev/rpa-replays';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';

(async () => {
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    
    console.log('\n📊 FINAL REPLAYS VERIFICATION\n');
    console.log('='.repeat(70));

    await loginWithTenantSelection(page, {
      targetUrl: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });

    // Load replays page
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // Get detailed replay data
    const replayInfo = await page.evaluate(() => {
      // Get all cells in table
      const cells = document.querySelectorAll('table tbody td');
      const rows = document.querySelectorAll('table tbody tr');
      
      // Get card items
      const cards = document.querySelectorAll('[style*="grid"]');
      
      // Get replay filenames
      const fileNameLinks = Array.from(document.querySelectorAll('a')).filter(a => 
        a.textContent.includes('.json') || 
        a.textContent.includes('replay') ||
        a.textContent.includes('wave')
      );

      // Get all visible text content related to replays
      const bodyText = document.body.innerText;
      const hasReplayText = bodyText.includes('replay') || bodyText.includes('Arquivo');
      
      return {
        rows: rows.length,
        cells: cells.length,
        cards: cards.length,
        fileLinks: fileNameLinks.length,
        sampleFiles: fileNameLinks.map(a => a.textContent.trim()).slice(0, 5),
        hasReplayIndicators: {
          replayText: bodyText.includes('replay'),
          arquivo: bodyText.includes('Arquivo'),
          columns: bodyText.includes('Resultado'),
        },
        firstRowText: rows[0] ? rows[0].innerText.substring(0, 100) : 'none',
      };
    });

    console.log('\n1️⃣ Table Data:');
    console.log(`   Rows: ${replayInfo.rows}`);
    console.log(`   Cells: ${replayInfo.cells}`);

    console.log('\n2️⃣ File Links Found:');
    console.log(`   Total: ${replayInfo.fileLinks}`);
    if (replayInfo.sampleFiles.length > 0) {
      console.log(`   Samples:`);
      replayInfo.sampleFiles.forEach(f => console.log(`      - ${f.substring(0, 50)}`));
    }

    console.log('\n3️⃣ Page Indicators:');
    console.log(`   Has "Arquivo" label: ${replayInfo.hasReplayIndicators.arquivo ? '✅' : '❌'}`);
    console.log(`   Has "Resultado" label: ${replayInfo.hasReplayIndicators.columns ? '✅' : '❌'}`);
    console.log(`   Has replay mentions: ${replayInfo.hasReplayIndicators.replayText ? '✅' : '❌'}`);

    console.log('\n4️⃣ First Row Sample:');
    console.log(`   ${replayInfo.firstRowText}`);

    // Try clicking the first row to see details
    if (replayInfo.rows > 0) {
      console.log('\n5️⃣ Attempting to click first replay...');
      const firstLink = await page.$('table tbody tr:first-child a');
      if (firstLink) {
        const fileName = await firstLink.textContent();
        console.log(`   Found link: ${fileName.substring(0, 50)}`);
      }
    }

    console.log('\n' + '='.repeat(70));

    if (replayInfo.rows > 0 || replayInfo.fileLinks > 0) {
      console.log('\n✅ SUCCESS! Replays are visible on the page');
      console.log(`   ${replayInfo.rows} table rows with replay data`);
    } else {
      console.log('\n❌ No replays visible');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
