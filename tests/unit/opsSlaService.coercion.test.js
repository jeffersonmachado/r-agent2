'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('opsSlaService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('runSlaScan tolerates hostile error.message getter from DB query failures', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const sequelize = {
      query: jest.fn(async () => {
        throw hostileError;
      }),
    };

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => sequelize),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const { runSlaScan } = require('../../api/services/opsSlaService');
    const out = await runSlaScan();

    expect(out.ok).toBe(true);
    expect(out.orders).toEqual({ ok: false, error: '' });
    expect(out.physical).toEqual({ ok: false, error: '' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/opsSlaService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
