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

const { resolveConfiguredExecutablePath } = require('../../api/services/whatsappQrBridgeService');

describe('whatsappQrBridgeService.resolveConfiguredExecutablePath', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('nunca retorna caminho inexistente (regressão: puppeteer sem download sombreava Chrome do sistema)', () => {
    delete process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;

    const resolved = resolveConfiguredExecutablePath();

    // Invariante do bug de 2026-07: puppeteer.executablePath() pode apontar
    // para um Chrome nunca baixado; o resolvedor só pode devolver um binário
    // que existe (puppeteer com download, candidato do sistema) ou ''.
    if (resolved) {
      expect(fs.existsSync(resolved)).toBe(true);
    } else {
      expect(resolved).toBe('');
    }
  });

  test('variável de ambiente explícita tem precedência e é respeitada', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-chrome-'));
    const realPath = path.join(tmpDir, 'chrome');
    fs.writeFileSync(realPath, '');
    process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH = realPath;

    expect(resolveConfiguredExecutablePath()).toBe(realPath);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('PUPPETEER_EXECUTABLE_PATH também é honrado como override', () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/chrome-custom/chrome';
    delete process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH;

    expect(resolveConfiguredExecutablePath()).toBe('/opt/chrome-custom/chrome');
  });
});
