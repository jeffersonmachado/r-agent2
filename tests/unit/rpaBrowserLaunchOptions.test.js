jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  resolveSystemBrowserPath,
  isMissingBrowserError,
} = require('../../core/rpa/utils/browserLaunchOptions');

describe('RPA browser launch fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolve caminho do sistema quando which retorna chromium', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '/usr/bin/chromium\n' });
    fs.existsSync.mockImplementation((candidate) => candidate === '/usr/bin/chromium');

    const result = resolveSystemBrowserPath();

    expect(result.path).toBe('/usr/bin/chromium');
    expect(result.candidates).toContain('/usr/bin/chromium');
  });

  test('retorna null quando nenhum browser do sistema é encontrado', () => {
    spawnSync.mockReturnValue({ status: 1, stdout: '' });
    fs.existsSync.mockReturnValue(false);

    const result = resolveSystemBrowserPath();

    expect(result.path).toBeNull();
  });

  test('detecta erros típicos de browser ausente do playwright', () => {
    expect(isMissingBrowserError(new Error('Executable doesn\'t exist at /tmp/chromium'))).toBe(true);
    expect(isMissingBrowserError(new Error('random failure'))).toBe(false);
  });
});
