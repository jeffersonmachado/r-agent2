'use strict';

/**
 * browserOperationalRunner.js
 *
 * Execução browser-first real via Playwright para jornadas operacionais blocking.
 *
 * Garantias obrigatórias por step:
 *   - screenshotBefore real
 *   - screenshotAfter real
 *   - domSnapshot real
 *   - url real (page.url())
 *   - networkEvents reais (request/response/requestfailed)
 *   - mutationLinkage gerado após afterStepSnapshot + incrementalDiff
 *   - evidenceId
 *
 * Se page === null em jornada blocking => NO_GO imediato.
 * Se screenshot falhar em jornada blocking => NO_GO imediato.
 * Se DOM snapshot falhar em jornada blocking => NO_GO imediato.
 * Se networkEvents ausentes em jornada blocking => NO_GO imediato.
 *
 * Playwright é carregado de forma lazy (não quebra servidores sem PLAYWRIGHT disponível).
 */

const logger = require('../../utils/logger');
const operationalStepExecutor = require('./operationalStepExecutor');
const { isBlockingJourney } = require('../../../qa/contracts/journeyCriticality');
const fs = require('fs');

// ── Constantes ────────────────────────────────────────────────────────────────

// Jornadas blocking: fonte única em config/journey-criticality.json
// (resolver qa/contracts/journeyCriticality) — sem lista/substring hardcoded.
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_NAV_TIMEOUT_MS = 45000;
const SYSTEM_CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

// ── Playwright lazy loader ────────────────────────────────────────────────────

let _chromium = null;

function getChromium() {
  if (_chromium) return _chromium;
  try {
    const pw = require('playwright');
    _chromium = pw.chromium;
    return _chromium;
  } catch (_) {
    return null;
  }
}

function resolveSystemChromeExecutable() {
  return SYSTEM_CHROME_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  }) || null;
}

// ── Utilitários ───────────────────────────────────────────────────────────────

// isBlockingJourney vem do registry (qa/contracts/journeyCriticality).
function buildBlockerEntry(reason, details = {}) {
  return { reason, blocking: true, ...details };
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────

/**
 * Lança browser real e retorna { page, browser, close }.
 * Se Playwright não estiver disponível => lança erro (blocker).
 *
 * @param {object} options
 * @param {string} [options.baseUrl] - URL base da aplicação
 * @param {boolean} [options.headless=true]
 * @param {object} [options.viewport]
 * @param {number} [options.timeoutMs]
 * @param {object} [options.extraHTTPHeaders] - cabeçalhos HTTP adicionais (ex: auth token)
 * @returns {Promise<{ page: import('playwright').Page, browser: import('playwright').Browser, close: Function }>}
 */
async function launchBrowserPage(options = {}) {
  const chromium = getChromium();
  if (!chromium) {
    throw new Error('playwright_not_available: Playwright não está instalado ou USE_PLAYWRIGHT não habilitado');
  }

  const headless = options.headless !== false;
  const viewport = options.viewport || DEFAULT_VIEWPORT;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  let browser;
  try {
    browser = await chromium.launch({ headless });
  } catch (err) {
    const executablePath = resolveSystemChromeExecutable();
    if (!executablePath) throw err;
    logger.warn(`[BrowserOperationalRunner] Chromium Playwright indisponível; usando Chrome do sistema: ${executablePath}`);
    browser = await chromium.launch({
      headless,
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: options.extraHTTPHeaders || {},
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(options.navTimeoutMs || DEFAULT_NAV_TIMEOUT_MS);

  return {
    page,
    browser,
    close: async () => {
      try { await browser.close(); } catch (_) { /* noop */ }
    },
  };
}

// ── Evidence capture real ─────────────────────────────────────────────────────

/**
 * Captura screenshot real da página.
 * Em jornada blocking, falha retorna blocker.
 *
 * @param {import('playwright').Page} page
 * @param {string} journeyId
 * @param {'before'|'after'|'failure'|'transition'} phase
 * @returns {Promise<{ screenshot: string|null, blocker: object|null }>}
 */
async function captureScreenshot(page, journeyId, phase = 'after') {
  if (!page || typeof page.screenshot !== 'function') {
    const blocker = isBlockingJourney(journeyId)
      ? buildBlockerEntry(`screenshot_${phase}_no_page`, { journeyId, phase })
      : null;
    return { screenshot: null, blocker };
  }

  try {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return { screenshot: `data:image/png;base64,${buf.toString('base64')}`, blocker: null };
  } catch (err) {
    logger.warn(`[BrowserOperationalRunner] screenshot ${phase} falhou: ${err.message}`);
    const blocker = isBlockingJourney(journeyId)
      ? buildBlockerEntry(`screenshot_${phase}_capture_failed`, { journeyId, phase, error: err.message })
      : null;
    return { screenshot: null, blocker };
  }
}

/**
 * Captura DOM snapshot real (page.content()).
 * Em jornada blocking, falha retorna blocker.
 *
 * @param {import('playwright').Page} page
 * @param {string} journeyId
 * @returns {Promise<{ domSnapshot: string|null, blocker: object|null }>}
 */
async function captureDomSnapshot(page, journeyId) {
  if (!page || typeof page.content !== 'function') {
    const blocker = isBlockingJourney(journeyId)
      ? buildBlockerEntry('dom_snapshot_no_page', { journeyId })
      : null;
    return { domSnapshot: null, blocker };
  }

  try {
    const content = await page.content();
    return { domSnapshot: content ? content.slice(0, 8192) : null, blocker: null };
  } catch (err) {
    logger.warn(`[BrowserOperationalRunner] DOM snapshot falhou: ${err.message}`);
    const blocker = isBlockingJourney(journeyId)
      ? buildBlockerEntry('dom_snapshot_capture_failed', { journeyId, error: err.message })
      : null;
    return { domSnapshot: null, blocker };
  }
}

// ── Execução de jornada com browser real ──────────────────────────────────────

/**
 * Executa steps de jornada blocking com browser Playwright real.
 *
 * Para cada step:
 *   1. screenshotBefore
 *   2. execute(page) — ação real na UI
 *   3. screenshotAfter
 *   4. domSnapshot
 *   5. URL real
 *   6. networkEvents reais (já coletados pelo startNetworkCapture do operationalStepExecutor)
 *   7. mutationLinkage gerado após incrementalDiff
 *   8. evidenceId
 *   9. Validação → NO_GO imediato se falta evidência em jornada blocking
 *
 * @param {string} journeyId
 * @param {Array<object>} stepSpecs - steps com campo execute(page) opcional
 * @param {object} options
 * @param {import('playwright').Page} [options.page] - página já aberta (injeção externa, para testes)
 * @param {string} [options.baseUrl]
 * @param {boolean} [options.headless]
 * @param {string} [options.replayId]
 * @param {string} [options.executionId]
 * @param {object} [options.stateMutation]
 * @param {object} [options.seedEvidence]
 * @param {object} [options.extraHTTPHeaders]
 * @returns {Promise<{
 *   steps: object[],
 *   stepResults: object[],
 *   blockers: object[],
 *   goNoGo: string|null,
 *   browserUsed: boolean,
 *   executorUsed: boolean,
 * }>}
 */
async function executeBlockingJourneyWithBrowser(journeyId, stepSpecs = [], options = {}) {
  const blocking = isBlockingJourney(journeyId);
  let ownedBrowser = false;
  let page = options.page || null;
  let closeFn = null;
  const preBlockers = [];

  // ── Fase 1: obter página real ─────────────────────────────────────────────
  if (!page) {
    if (!blocking) {
      // Não blocking: executa sem browser real
      return _executeWithoutBrowser(journeyId, stepSpecs, options);
    }

    try {
      const launched = await module.exports.launchBrowserPage({
        headless: options.headless !== false,
        baseUrl: options.baseUrl,
        viewport: options.viewport,
        timeoutMs: options.timeoutMs,
        navTimeoutMs: options.navTimeoutMs,
        extraHTTPHeaders: options.extraHTTPHeaders || {},
      });
      page = launched.page;
      closeFn = launched.close;
      ownedBrowser = true;
    } catch (launchErr) {
      logger.error(`[BrowserOperationalRunner] Falha ao lançar browser: ${launchErr.message}`);
      if (blocking) {
        return {
          steps: [],
          stepResults: [],
          blockers: [buildBlockerEntry('browser_launch_failed', { journeyId, error: launchErr.message })],
          goNoGo: 'NO_GO',
          browserUsed: false,
          executorUsed: false,
        };
      }
      return _executeWithoutBrowser(journeyId, stepSpecs, options);
    }
  }

  // ── Fase 2: auto-login (rotas operacionais são protegidas) ────────────────
  // Reusa o mesmo fluxo de auto-login dos runners RPA (token RPA -> fallback UI).
  // Em jornada blocking, falha de login gera blocker explícito (nunca finge sucesso).
  if (options.autoLogin && page && typeof page.goto === 'function') {
    let authResult = null;
    try {
      const { autoLoginBeforeSteps } = require('../../../core/rpa/utils/autoLoginFlow');
      // Garante mesma origem do alvo mesmo se options.baseUrl não vier:
      // localStorage é por origem — logar em outra origem perde a sessão.
      const loginBaseUrl = options.baseUrl
        || (() => {
          try { return options.loginTargetUrl ? new URL(options.loginTargetUrl).origin : undefined; } catch (_) { return undefined; }
        })();
      authResult = await autoLoginBeforeSteps(page, {
        firstStep: options.loginTargetUrl
          ? { type: 'navigate', url: options.loginTargetUrl }
          : undefined,
        frontendBaseUrl: loginBaseUrl,
        apiBaseUrl: options.apiBaseUrl,
        authOptions: options.authOptions || {},
      });
    } catch (authErr) {
      authResult = { success: false, loggedIn: false, error: authErr.message };
    }

    if (!authResult.success || (!authResult.loggedIn && !authResult.skipped)) {
      const reason = !authResult.success ? 'auto_login_failed' : 'auto_login_not_authenticated';
      logger.error(`[BrowserOperationalRunner] Auto-login falhou (${reason}): ${authResult.error || authResult.skipReason || 'sem detalhes'}`);
      if (blocking) {
        if (ownedBrowser && closeFn) {
          await closeFn();
        }
        return {
          steps: [],
          stepResults: [],
          blockers: [buildBlockerEntry(reason, {
            journeyId,
            error: authResult.error || null,
            skipReason: authResult.skipReason || null,
          })],
          goNoGo: 'NO_GO',
          browserUsed: true,
          executorUsed: false,
          stepsExecuted: 0,
          stepsTotal: stepSpecs.length,
        };
      }
      logger.warn(`[BrowserOperationalRunner] Auto-login não aplicado em jornada não-blocking (${reason})`);
    } else if (authResult.loggedIn) {
      logger.info('[BrowserOperationalRunner] Auto-login realizado com sucesso');
    }
  }

  // ── Fase 3: navegar para URL inicial ─────────────────────────────────────
  if (options.initialUrl && typeof page.goto === 'function') {
    try {
      await page.goto(options.initialUrl, { waitUntil: 'domcontentloaded' });
    } catch (navErr) {
      logger.warn(`[BrowserOperationalRunner] Navegação inicial falhou: ${navErr.message}`);
      if (blocking) {
        if (ownedBrowser && closeFn) {
          await closeFn();
        }
        return {
          steps: [],
          stepResults: [],
          blockers: [buildBlockerEntry('initial_navigation_failed', { journeyId, url: options.initialUrl, error: navErr.message })],
          goNoGo: 'NO_GO',
          browserUsed: true,
          executorUsed: false,
          stepsExecuted: 0,
          stepsTotal: stepSpecs.length,
        };
      }
    }
  }

  // ── Fase 4: executar steps com evidências reais ───────────────────────────
  let finalResult;
  try {
    finalResult = await operationalStepExecutor.executeOperationalSteps(stepSpecs, page, {
      journeyId,
      replayId: options.replayId || null,
      executionId: options.executionId || null,
      stateMutation: options.stateMutation || null,
      seedEvidence: options.seedEvidence || null,
      collectStepSnapshot: options.collectStepSnapshot,
    });
  } catch (execErr) {
    logger.error(`[BrowserOperationalRunner] Execução de steps falhou: ${execErr.message}`);
    finalResult = {
      steps: [],
      stepResults: [],
      goNoGo: 'NO_GO',
      totalBlockers: 1,
      blockers: [buildBlockerEntry('step_execution_failed', { journeyId, error: execErr.message })],
      stepsExecuted: 0,
      stepsTotal: stepSpecs.length,
    };
  } finally {
    if (ownedBrowser && closeFn) {
      await closeFn();
    }
  }

  const allBlockers = [...preBlockers, ...(finalResult.blockers || [])];
  const goNoGo = finalResult.goNoGo || (allBlockers.some((b) => b.blocking) ? 'NO_GO' : null);

  return {
    steps: finalResult.steps || [],
    stepResults: finalResult.stepResults || [],
    blockers: allBlockers,
    goNoGo,
    browserUsed: true,
    executorUsed: true,
    stepsExecuted: finalResult.stepsExecuted || 0,
    stepsTotal: finalResult.stepsTotal || stepSpecs.length,
  };
}

/**
 * Fallback sem browser — para jornadas não-blocking.
 * Passa null como page (comportamento anterior do sistema).
 */
async function _executeWithoutBrowser(journeyId, stepSpecs = [], options = {}) {
  const result = await operationalStepExecutor.executeOperationalSteps(stepSpecs, null, {
    journeyId,
    replayId: options.replayId || null,
    executionId: options.executionId || null,
    stateMutation: options.stateMutation || null,
    seedEvidence: options.seedEvidence || null,
    collectStepSnapshot: options.collectStepSnapshot,
  });

  return {
    steps: result.steps || [],
    stepResults: result.stepResults || [],
    blockers: result.blockers || [],
    goNoGo: result.goNoGo || null,
    browserUsed: false,
    executorUsed: true,
    stepsExecuted: result.stepsExecuted || 0,
    stepsTotal: result.stepsTotal || stepSpecs.length,
  };
}

// ── Validação pré-execução de page ────────────────────────────────────────────

/**
 * Valida que page não é null para jornada blocking.
 * Retorna { valid, blocker } para uso em gates.
 *
 * @param {import('playwright').Page|null} page
 * @param {string} journeyId
 * @returns {{ valid: boolean, blocker: object|null }}
 */
function validatePageForJourney(page, journeyId) {
  if (page !== null && page !== undefined) return { valid: true, blocker: null };
  const blocking = isBlockingJourney(journeyId);
  if (!blocking) return { valid: true, blocker: null };
  return {
    valid: false,
    blocker: buildBlockerEntry('page_null_blocking_journey', {
      journeyId,
      detail: 'Playwright page é null em jornada blocking — NO_GO obrigatório',
    }),
  };
}

/**
 * Valida que um step executado tem todas as evidências reais capturadas.
 * Usado pelos step reporters para gate final de evidência.
 *
 * @param {object} step - step já executado e enriquecido
 * @param {string} journeyId
 * @returns {{ valid: boolean, missingEvidence: string[], goNoGo: string|null }}
 */
function validateRealEvidence(step = {}, journeyId = '') {
  return operationalStepExecutor.validateStepEvidence(step, journeyId);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Core execution
  executeBlockingJourneyWithBrowser,
  launchBrowserPage,

  // Evidence capture
  captureScreenshot,
  captureDomSnapshot,

  // Gates
  validatePageForJourney,
  validateRealEvidence,

  // Util
  isBlockingJourney,

  // Internals expostos para testes
  _executeWithoutBrowser,
  getChromium,
};
