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
    
    console.log('\n🔒 DIRECT LOGIN API TEST\n');
    console.log('='.repeat(70));

    // Navigate first to set up context
    await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Now make a direct fetch call to login
    console.log('\n1️⃣ Making direct POST to /auth/login');

    const apiResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            username: 'systemadmin',
            password: 'Admin123!'
          })
        });

        const responseData = {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          url: response.url,
          headers: {}
        };

        // Get headers
        response.headers.forEach((value, key) => {
          responseData.headers[key] = value;
        });

        // Get body
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          responseData.body = await response.clone().json();
        } else {
          responseData.body = await response.clone().text();
        }

        return responseData;
      } catch (err) {
        return {
          error: err.message,
          errorType: err.constructor.name
        };
      }
    });

    console.log(`   Status: ${apiResponse.status}`);
    console.log(`   Status Text: ${apiResponse.statusText}`);
    console.log(`   OK: ${apiResponse.ok}`);
    console.log(`   URL: ${apiResponse.url}`);

    if (apiResponse.error) {
      console.log(`\n   ❌ Error: ${apiResponse.error}`);
    } else {
      console.log(`\n   Response body:`);
      if (typeof apiResponse.body === 'object') {
        console.log(JSON.stringify(apiResponse.body, null, 2));
      } else {
        console.log(`   ${apiResponse.body.substring(0, 300)}`);
      }

      // Check for token
      if (apiResponse.body && apiResponse.body.token) {
        console.log(`\n   ✅ Token in response: ${apiResponse.body.token.substring(0, 50)}...`);
      } else if (apiResponse.body && apiResponse.body.error) {
        console.log(`\n   ❌ Error in response: ${apiResponse.body.error}`);
        if (apiResponse.body.message) {
          console.log(`      Message: ${apiResponse.body.message}`);
        }
      } else {
        console.log(`\n   ⚠️  No token or error in response`);
      }
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
