'use strict';

/**
 * Guarda de tempo global do auto-login RPA (RPA_AUTOLOGIN_TIMEOUT_MS).
 *
 * Motivação: rpa-whatsapp-connections-rpa ficou 182min pendurado no login
 * durante o mesh canônico de 2026-09-03 (runner sequencial congelado).
 * Com a guarda, um login que não conclui no prazo falha rápido e o cenário
 * segue a semântica normal de falha.
 */

jest.mock('../../core/rpa/utils/authHelper', () => ({
  ensureAuthenticated: jest.fn(),
  handleTenantSelectorModalIfPresent: jest.fn().mockResolvedValue(false),
}));

const { ensureAuthenticated } = require('../../core/rpa/utils/authHelper');
const { autoLoginBeforeSteps } = require('../../core/rpa/utils/autoLoginFlow');

function fakePage() {
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('http://localhost:5173/login'),
  };
}

describe('autoLoginBeforeSteps — guarda de timeout global', () => {
  const envBackup = process.env.RPA_AUTOLOGIN_TIMEOUT_MS;
  const { handleTenantSelectorModalIfPresent } = require('../../core/rpa/utils/authHelper');

  beforeEach(() => {
    handleTenantSelectorModalIfPresent.mockResolvedValue(false);
  });

  afterEach(() => {
    if (typeof envBackup === 'undefined') delete process.env.RPA_AUTOLOGIN_TIMEOUT_MS;
    else process.env.RPA_AUTOLOGIN_TIMEOUT_MS = envBackup;
    jest.clearAllMocks();
  });

  test('login pendurado falha rápido com auto_login_timeout (não congela o runner)', async () => {
    process.env.RPA_AUTOLOGIN_TIMEOUT_MS = '50';
    // Simula await sem timeout na cadeia de login: nunca resolve.
    ensureAuthenticated.mockImplementation(() => new Promise(() => {}));

    const started = Date.now();
    const result = await autoLoginBeforeSteps(fakePage(), {
      frontendBaseUrl: 'http://localhost:5173',
    });
    const elapsed = Date.now() - started;

    expect(result.success).toBe(false);
    expect(result.loggedIn).toBe(false);
    expect(result.timeout).toBe(true);
    expect(result.error).toContain('auto_login_timeout');
    expect(elapsed).toBeLessThan(5000);
  }, 15000);

  test('login que resolve antes do prazo retorna o resultado normal (sem regressão)', async () => {
    process.env.RPA_AUTOLOGIN_TIMEOUT_MS = '5000';
    ensureAuthenticated.mockResolvedValue({ success: true, loggedIn: true });

    const result = await autoLoginBeforeSteps(fakePage(), {
      frontendBaseUrl: 'http://localhost:5173',
      firstStep: { type: 'navigate', url: 'http://localhost:5173/whatsapp-connections' },
    });

    expect(result.success).toBe(true);
    expect(result.loggedIn).toBe(true);
    expect(result.timeout).toBeUndefined();
  }, 15000);
});
