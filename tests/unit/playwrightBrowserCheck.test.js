'use strict';

describe('playwrightBrowserCheck (boot)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadCheck({ launchImpl, requireFails = false } = {}) {
    if (requireFails) {
      jest.doMock('playwright', () => {
        throw new Error("Cannot find module 'playwright'");
      }, { virtual: true });
    } else {
      jest.doMock('playwright', () => ({
        chromium: { launch: jest.fn(launchImpl) },
      }), { virtual: true });
    }
    return require('../../api/runtime/playwrightBrowserCheck');
  }

  test('browser ausente (launch falha com Executable doesn\'t exist) gera warn com remediação', async () => {
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const { checkPlaywrightBrowser } = loadCheck({
      launchImpl: async () => {
        throw new Error(
          "browserType.launch: Executable doesn't exist at /home/x/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell"
        );
      },
    });

    const result = await checkPlaywrightBrowser({ logger });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('playwright_browser_missing');
    expect(result.remediation).toContain('npx playwright install chromium');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[PlaywrightBootCheck]'),
      expect.objectContaining({ remediation: expect.stringContaining('npx playwright install chromium') })
    );
  });

  test('browser presente (launch ok) retorna ok sem warn', async () => {
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const close = jest.fn(async () => {});
    const { checkPlaywrightBrowser } = loadCheck({
      launchImpl: async () => ({ close }),
    });

    const result = await checkPlaywrightBrowser({ logger });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(close).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('lib playwright ausente não quebra boot e avisa', async () => {
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const { checkPlaywrightBrowser } = loadCheck({ requireFails: true });

    const result = await checkPlaywrightBrowser({ logger });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('playwright_not_installed');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('falha genérica de launch é reportada sem confundir com browser ausente', async () => {
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const { checkPlaywrightBrowser } = loadCheck({
      launchImpl: async () => {
        throw new Error('browserType.launch: Target closed unexpectedly');
      },
    });

    const result = await checkPlaywrightBrowser({ logger });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('playwright_launch_failed');
    expect(result.remediation).toContain('npx playwright install chromium');
  });
});
