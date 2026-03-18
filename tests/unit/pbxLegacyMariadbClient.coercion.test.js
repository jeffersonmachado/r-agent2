'use strict';

const fs = require('fs');
const path = require('path');

describe('pbxLegacy mariadbClient coercion hardening', () => {
  const originalMariaDbUrl = process.env.PBX_MARIADB_URL;
  const originalRetryAttempts = process.env.PBX_MARIADB_RETRY_ATTEMPTS;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.PBX_MARIADB_URL = 'mysql://user:pass@localhost:3306/test';
    process.env.PBX_MARIADB_RETRY_ATTEMPTS = '1';
  });

  afterAll(() => {
    if (originalMariaDbUrl === undefined) delete process.env.PBX_MARIADB_URL;
    else process.env.PBX_MARIADB_URL = originalMariaDbUrl;

    if (originalRetryAttempts === undefined) delete process.env.PBX_MARIADB_RETRY_ATTEMPTS;
    else process.env.PBX_MARIADB_RETRY_ATTEMPTS = originalRetryAttempts;
  });

  test('checkMariaDbHealth tolerates hostile error.message getter from query failure', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const pool = {
      query: jest.fn(async () => {
        throw hostileError;
      }),
    };

    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((_, fallback) => fallback),
    }));
    jest.doMock('mysql2/promise', () => ({
      createPool: jest.fn(() => pool),
    }), { virtual: true });

    const { checkMariaDbHealth } = require('../../api/services/pbxLegacy/mariadbClient');
    const out = await checkMariaDbHealth();

    expect(out).toEqual({ configured: true, status: 'unhealthy', error: '' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/pbxLegacy/mariadbClient.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});