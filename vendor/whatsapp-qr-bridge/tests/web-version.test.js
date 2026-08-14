'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createBridge,
  resolveWebVersionOptions,
  PINNED_WEB_VERSION,
  WA_WEB_CACHE_DIR,
} = require('../src/index');

test('resolveWebVersionOptions: default pin para build pré-quebra com cache local do pacote', () => {
  const opts = resolveWebVersionOptions();
  assert.equal(opts.webVersion, PINNED_WEB_VERSION);
  assert.equal(opts.webVersionCache.type, 'local');
  assert.equal(opts.webVersionCache.path, path.resolve(WA_WEB_CACHE_DIR));
  // O HTML pinado precisa existir no pacote — sem ele o Client cai no
  // comportamento quebrado silenciosamente.
  assert.ok(fs.existsSync(path.join(opts.webVersionCache.path, `${opts.webVersion}.html`)));
});

test('resolveWebVersionOptions: null/false/vazio desliga o pin', () => {
  assert.deepEqual(resolveWebVersionOptions({ webVersion: null }), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: false }), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: '' }), {});
});

test('resolveWebVersionOptions: versão e diretório customizados', () => {
  const opts = resolveWebVersionOptions({ webVersion: '9.9.9-test', webVersionCacheDir: '/tmp/wa-cache' });
  assert.equal(opts.webVersion, '9.9.9-test');
  assert.deepEqual(opts.webVersionCache, { type: 'local', path: '/tmp/wa-cache' });
});

test('createBridge repassa webVersion/webVersionCacheDir à clientFactory', async () => {
  const received = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqr-webver-'));
  const bridge = createBridge({
    authDataPath: dir,
    syncIntervalMs: 0,
    webVersion: '1.2.3-custom',
    webVersionCacheDir: '/tmp/custom-cache',
    clientFactory: (opts) => {
      received.push(opts);
      return {
        on() {},
        async initialize() {},
        async destroy() {},
      };
    },
  });

  await bridge.addConnection({ id: 'conn-webver' });
  assert.equal(received.length, 1);
  assert.equal(received[0].webVersion, '1.2.3-custom');
  assert.equal(received[0].webVersionCacheDir, '/tmp/custom-cache');

  await bridge.stop();
});
