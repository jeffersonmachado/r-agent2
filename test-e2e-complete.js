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
    
    console.log('\n✅ COMPLETE END-TO-END FLOW\n');
    console.log('='.repeat(70));

    // STEP 1: Login
    console.log('\n1️⃣ Logging in as systemadmin...');
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
    
    await page.waitForTimeout(2500);
    console.log('   ✅ Login complete');

    // STEP 2: Select tenant via clicking the first button in the modal
    console.log('\n2️⃣ Selecting System tenant from modal...');
    
    // Wait for modal to be visible and find the System button
    const allButtons = await page.$$('button');
    let systemClicked = false;
    
    for (const btn of allButtons) {
      const text = await btn.textContent();
      // Look for button containing "System" and not "Selecione" or "Acessar"
      if (text.includes('System') && !text.includes('Selecione') && !text.includes('Acessar') && !text.includes('Cancelar')) {
        try {
          await btn.click({ timeout: 2000 });
          console.log(`   ✅ System tenant button clicked`);
          systemClicked = true;
          break;
        } catch (e) {
          // Continue searching
        }
      }
    }

    if (!systemClicked) {
      console.log('   ⚠️  Could not find exact System button, trying first tenant option...');
      // Find all divs with role=button (tenant options)
      const btnElements = await page.$$('button');
      // Filter out header buttons and modal buttons
      let clicked = false;
      for (let i = 0; i < btnElements.length; i++) {
        const text = await btnElements[i].textContent();
        // Tenant buttons usually contain "•" (bullet) for "id • type" format
        if (text.includes('•') && !text.includes('Selecione') && !text.includes('Acessar')) {
          try {
            await btnElements[i].click({ timeout: 2000 });
            console.log(`   ✅ First tenant option clicked`);
            clicked = true;
            break;
          } catch (e) {
            // Try next
          }
        }
      }
      if (!clicked) {
        console.log('   ❌ Could not click any tenant');
      }
    }

    await page.waitForTimeout(800);

    // STEP 3: Click "Acessar" button
    console.log('\n3️⃣ Clicking "Acessar" button...');
    
    const accessButtons = await page.$$('button');
    let acessarClicked = false;
    
    for (const btn of accessButtons) {
      const text = await btn.textContent();
      if (text.toLowerCase().includes('acessar')) {
        try {
          // Make sure button is enabled
          const isDisabled = await btn.evaluate(el => el.disabled);
          if (!isDisabled) {
            await btn.click({ timeout: 2000 });
            console.log('   ✅ Acessar button clicked');
            acessarClicked = true;
            break;
          } else {
            console.log('   ⚠️  Acessar button is disabled');
          }
        } catch (e) {
          console.log(`   ⚠️  Error clicking Acessar: ${e.message}`);
        }
      }
    }

    // Wait for navigation/page load
    await page.waitForTimeout(3000);

    // STEP 4: Check if we're on replays page
    console.log('\n4️⃣ Checking final state...');
    
    const finalState = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
        hasTable: !!document.querySelector('table'),
        tableRows: document.querySelectorAll('table tbody tr').length,
        hasCheckbox: !!document.querySelector('input[type="checkbox"]'),
        pageText: document.body.innerText.substring(0, 300),
      };
    });

    console.log(`   URL: ${finalState.url}`);
    console.log(`   Pathname: ${finalState.pathname}`);
    console.log(`   Title: ${finalState.title}`);
    console.log(`   Has table: ${finalState.hasTable ? '✅' : '❌'}`);
    console.log(`   Table rows: ${finalState.tableRows}`);
    console.log(`   Has checkbox: ${finalState.hasCheckbox ? '✅' : '❌'}`);

    // STEP 5: Get sample replays
    if (finalState.hasTable && finalState.tableRows > 0) {
      console.log('\n5️⃣ Sample replays found:');
      
      const replayNames = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows)
          .map(row => {
            const firstCell = row.querySelector('td:nth-child(2)'); // Skip checkbox column
            return firstCell ? firstCell.innerText.substring(0, 50) : '?';
          })
          .slice(0, 5);
      });

      replayNames.forEach((name, i) => console.log(`      ${i + 1}. ${name}`));
    }

    console.log('\n' + '='.repeat(70));
    
    if (finalState.hasTable && finalState.tableRows > 0) {
      console.log('\n✅ SUCCESS! RPA Replays page loaded with ' + finalState.tableRows + ' replays');
    } else if (finalState.pathname === '/dev/rpa-replays') {
      console.log('\n⚠️  Page navigated to /dev/rpa-replays but no table visible yet (may be loading)');
    } else {
      console.log('\n❌ Not on RPA Replays page yet (' + finalState.pathname + ')');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
