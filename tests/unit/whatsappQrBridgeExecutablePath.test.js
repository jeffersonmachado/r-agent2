'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('whatsappQrBridgeService.resolveConfiguredExecutablePath', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadService(puppeteerExecutablePath) {
    jest.doMock('puppeteer', () => ({
      executablePath: jest.fn(() => puppeteerExecutablePath),
    }), { virtual: true });
    return require('../../api/services/whatsappQrBridgeService');
  }

  test('caminho do puppeteer inexistente nao deve ser retornado (fallback para Chrome do sistema)', () => {
    delete process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;

    const bogusPath = path.join(os.tmpdir(), 'puppeteer-chrome-inexistente', 'chrome');
    const svc = loadService(bogusPath);

    const resolved = svc.resolveConfiguredExecutablePath();
    expect(resolved).not.toBe(bogusPath);
    // Ou cai num candidato de sistema existente, ou retorna '' — nunca um caminho quebrado.
    if (resolved) {
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });

  test('caminho do puppeteer existente continua sendo respeitado', () => {
    delete process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-chrome-'));
    const realPath = path.join(tmpDir, 'chrome');
    fs.writeFileSync(realPath, '');

    const svc = loadService(realPath);
    expect(svc.resolveConfiguredExecutablePath()).toBe(realPath);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('variavel de ambiente explicita tem precedencia sobre o puppeteer', () => {
    process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH = '/opt/chrome-custom/chrome';
    const svc = loadService('/qualquer/puppeteer/chrome');
    expect(svc.resolveConfiguredExecutablePath()).toBe('/opt/chrome-custom/chrome');
  });
});
