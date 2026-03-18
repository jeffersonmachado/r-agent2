'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('instagramService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  function mockInstagramConfig() {
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key) => {
        if (key === 'instagram.pageAccessToken') return 'token-1';
        if (key === 'messenger.pageAccessToken') return null;
        if (key === 'instagram.pageId') return 'page-1';
        return null;
      }),
    }));
  }

  test('sendInstagramMessage tolerates hostile error.message getter from fetch rejection', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    mockInstagramConfig();
    global.fetch = jest.fn(async () => {
      throw hostileError;
    });

    const svc = require('../../api/services/instagramService');
    const out = await svc.sendInstagramMessage('ig-user-1', 'Ola');

    expect(out).toEqual({ success: false, error: '' });
  });

  test('sendInstagramMedia tolerates hostile error.message getter from fetch rejection', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    mockInstagramConfig();
    global.fetch = jest.fn(async () => {
      throw hostileError;
    });

    const svc = require('../../api/services/instagramService');
    const out = await svc.sendInstagramMedia('ig-user-1', 'https://example.com/img.png', 'image');

    expect(out).toEqual({ success: false, error: '' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/instagramService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
