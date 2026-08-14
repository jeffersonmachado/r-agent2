'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveRuntimeRoot,
  resolveRuntimePath,
  configureRuntimeRoot,
} = require('../../api/utils/runtimePaths');

describe('runtimePaths — runtime root sem env var', () => {
  const originalHome = process.env.HOME;
  const originalNodeEnv = process.env.NODE_ENV;
  let fakeHome;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-default-home-'));
    configureRuntimeRoot(null);
    process.env.NODE_ENV = 'test';
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    process.env.NODE_ENV = originalNodeEnv;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('sem override usa ~/.local/share/ragent2-runtime (fora do workspace)', () => {
    const root = resolveRuntimeRoot();
    expect(root).toBe(path.join(fakeHome, '.local', 'share', 'ragent2-runtime'));
    expect(fs.existsSync(root)).toBe(true);

    const workspace = path.resolve(process.cwd());
    expect(root === workspace || root.startsWith(`${workspace}${path.sep}`)).toBe(false);
  });

  it('resolveRuntimePath compõe segmentos sob o default', () => {
    const dir = resolveRuntimePath('rpa', 'replay');
    expect(dir).toBe(path.join(fakeHome, '.local', 'share', 'ragent2-runtime', 'rpa', 'replay'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('configureRuntimeRoot dentro do workspace é rejeitado', () => {
    configureRuntimeRoot(path.join(process.cwd(), 'runtime-dentro-do-workspace'));
    expect(() => resolveRuntimeRoot()).toThrow(/fora do workspace/);
  });

  it('configureRuntimeRoot válido prevalece sobre o default', () => {
    const explicit = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-explicit-'));
    try {
      configureRuntimeRoot(explicit);
      expect(resolveRuntimeRoot()).toBe(path.resolve(explicit));
    } finally {
      fs.rmSync(explicit, { recursive: true, force: true });
    }
  });
});
