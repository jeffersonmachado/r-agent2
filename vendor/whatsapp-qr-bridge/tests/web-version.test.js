'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createBridge,
  resolveWebVersionOptions,
} = require('../src/index');

test('resolveWebVersionOptions: default é SEM pin (WA Web latest)', () => {
  // Pin de build antigo só funciona enquanto o WhatsApp mantém os assets no
  // CDN — builds removidos morrem no boot ('auth timeout'). O default precisa
  // ser o comportamento nativo da lib.
  assert.deepEqual(resolveWebVersionOptions(), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: null }), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: false }), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: '' }), {});
  assert.deepEqual(resolveWebVersionOptions({ webVersion: '   ' }), {});
});

test('resolveWebVersionOptions: pin custom com versão e diretório', () => {
  const opts = resolveWebVersionOptions({ webVersion: '9.9.9-test', webVersionCacheDir: '/tmp/wa-cache' });
  assert.equal(opts.webVersion, '9.9.9-test');
  assert.deepEqual(opts.webVersionCache, { type: 'local', path: '/tmp/wa-cache' });
});

test('resolveWebVersionOptions: pin custom sem diretório cai no default do pacote', () => {
  const opts = resolveWebVersionOptions({ webVersion: '9.9.9-test' });
  assert.equal(opts.webVersion, '9.9.9-test');
  assert.equal(opts.webVersionCache.type, 'local');
  assert.ok(opts.webVersionCache.path.endsWith('wa-web'));
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
