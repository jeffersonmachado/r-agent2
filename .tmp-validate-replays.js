const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const apiResponses = [];
  const requestFailures = [];
  const pageErrors = [];
  const consoleErrors = [];
  let gotoError = null;

  page.on('response', response => {
    if (response.url().includes('/api/test-executions/replays')) {
      apiResponses.push({ url: response.url(), status: response.status() });
    }
  });

  page.on('requestfailed', request => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure() ? request.failure().errorText : 'unknown'
    });
  });

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  console.log('Navegando para http://localhost:5173/dev/rpa-replays');
  try {
    await page.goto('http://localhost:5173/dev/rpa-replays', { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e) {
    gotoError = e.message;
    console.log('GOTO_ERROR=' + e.message);
  }

  await page.waitForTimeout(3000);

  const content = await page.content().catch(() => '');
  const textContent = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  const hasQaCoreAuthLogin = content.includes('qa-core-auth-login') || textContent.includes('qa-core-auth-login');

  console.log('API_REPLAYS_CALLED=' + (apiResponses.length > 0 ? 'YES' : 'NO'));
  console.log('API_REPLAYS_RESPONSES=' + JSON.stringify(apiResponses, null, 2));
  console.log('HAS_QA_CORE_AUTH_LOGIN=' + (hasQaCoreAuthLogin ? 'YES' : 'NO'));
  console.log('REQUEST_FAILURES=' + JSON.stringify(requestFailures, null, 2));
  console.log('PAGE_ERRORS=' + JSON.stringify(pageErrors, null, 2));
  console.log('CONSOLE_ERRORS=' + JSON.stringify(consoleErrors, null, 2));
  console.log('TEXT_SNIPPET=' + JSON.stringify(textContent.slice(0, 500)));

  await browser.close();
})().catch(e => {
  console.error('FATAL_ERROR=' + e.message);
  process.exit(1);
});
