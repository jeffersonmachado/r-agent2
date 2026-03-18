'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('planLimitsService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('incrementUsage tolerates hostile err.message getter in async persistence catch', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 'tenant-1', plan: 'free' })),
      getTenantUsage: jest.fn(async () => ({ max_agentes: 0 })),
    }));

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => {
        throw hostileError;
      }),
      upsertSetting: jest.fn(async () => ({ ok: true })),
    }));

    const logger = require('../../api/utils/logger');
    const { incrementUsage } = require('../../api/services/planLimitsService');

    expect(() => {
      incrementUsage('tenant-1', 'max_agentes', 1);
    }).not.toThrow();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.debug).toHaveBeenCalledWith(
      '[PlanLimits] Falha ao persistir uso (ignorado)',
      expect.objectContaining({ tenantId: 'tenant-1', resource: 'max_agentes', error: '' })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/planLimitsService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
