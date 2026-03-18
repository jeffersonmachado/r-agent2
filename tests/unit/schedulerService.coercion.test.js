'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('schedulerService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('tickScheduler tolerates hostile err.message getter in schedule update catch', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const scheduleRow = {
      toJSON: () => ({
        id: 's1',
        tenant_key: 'tenant-1',
        kind: 'job.kind',
        payload: {},
        interval_sec: 60,
        next_run_at: new Date().toISOString(),
      }),
      update: jest.fn(async () => {
        throw hostileError;
      }),
    };

    const ScheduleModel = {
      findAll: jest.fn(async () => [scheduleRow]),
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      Schedule: jest.fn(() => ScheduleModel),
    }));
    jest.doMock('../../api/services/executionQueueService', () => ({
      enqueueJob: jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const logger = require('../../api/utils/logger');
    const { tickScheduler } = require('../../api/services/schedulerService');

    await expect(tickScheduler({ batchSize: 1 })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[Scheduler] failed to update schedule (ignored)',
      { id: 's1', error: '' }
    );
  });

  test('startScheduler tick catches hostile err.message getter without throwing', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      Schedule: jest.fn(() => {
        throw hostileError;
      }),
    }));
    jest.doMock('../../api/services/executionQueueService', () => ({
      enqueueJob: jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const logger = require('../../api/utils/logger');
    const { startScheduler, stopScheduler } = require('../../api/services/schedulerService');

    expect(() => startScheduler({ intervalMs: 10, batchSize: 1 })).not.toThrow();

    await jest.advanceTimersByTimeAsync(500);
    stopScheduler();

    expect(logger.warn).toHaveBeenCalledWith(
      '[Scheduler] tick failed (ignored)',
      { error: '' }
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/schedulerService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
