'use strict';

/**
 * Verificação best-effort do browser do Playwright no boot da API.
 *
 * Motivação: validators de governança (validate:runtime, page-surface wave) e
 * RPA dependem do Chromium do Playwright. Se o cache de browsers for apagado
 * (~/.cache/ms-playwright), o boot seguia normal e a falha só aparecia no
 * gate — tarde demais. Este check faz um launch headless real (o único teste
 * que cobre o headless shell usado pelos validators) e loga warn com a
 * remediação exata. Nunca quebra o boot.
 *
 * Opt-out: ENABLE_PLAYWRIGHT_BOOT_CHECK=false.
 */

const REMEDIATION = 'npx playwright install chromium';
const LAUNCH_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_BOOT_CHECK_TIMEOUT_MS || 20000);

function safeErrorMessage(err) {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return String(message || err || '');
  } catch (_) {
    return '';
  }
}

function classifyLaunchFailure(message) {
  const normalized = String(message || '').toLowerCase();
  if (
    normalized.includes("executable doesn't exist") ||
    normalized.includes('executable doesn\'t exist') ||
    normalized.includes('run the following command to download') ||
    normalized.includes('browser was not found')
  ) {
    return 'playwright_browser_missing';
  }
  return 'playwright_launch_failed';
}

async function checkPlaywrightBrowser({ logger, timeoutMs = LAUNCH_TIMEOUT_MS } = {}) {
  const log = logger || { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };

  let chromium;
  try {
    // eslint-disable-next-line global-require
    ({ chromium } = require('playwright'));
  } catch (err) {
    const message = safeErrorMessage(err);
    log.warn('[PlaywrightBootCheck] playwright não está instalado — validators de runtime e RPA ficarão indisponíveis', {
      error: 'playwright_not_installed',
      message,
      remediation: 'npm install && npx playwright install chromium',
    });
    return { ok: false, error: 'playwright_not_installed', message, remediation: REMEDIATION };
  }

  let browser = null;
  try {
    browser = await Promise.race([
      chromium.launch({ headless: true }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`playwright_boot_check_timeout após ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true };
  } catch (err) {
    const message = safeErrorMessage(err);
    const error = classifyLaunchFailure(message);
    log.warn('[PlaywrightBootCheck] Chromium do Playwright indisponível — validators de runtime/RPA falharão até corrigir', {
      error,
      message: message.slice(0, 300),
      remediation: REMEDIATION,
    });
    return { ok: false, error, message, remediation: REMEDIATION };
  } finally {
    if (browser && typeof browser.close === 'function') {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}

module.exports = {
  checkPlaywrightBrowser,
};
