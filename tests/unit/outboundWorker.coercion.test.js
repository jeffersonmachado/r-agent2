'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('outboundWorker coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('start timer catch tolerates hostile err.message getter from processDue rejection', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const processDue = jest.fn(() => Promise.reject(hostileError));
    const stopWorker = jest.fn();

    jest.doMock('../../api/services/outboundQueueService', () => ({
      processDue,
      stopWorker,
    }));

    const logger = require('../../api/utils/logger');
    const worker = require('../../api/services/outboundWorker');

    worker.start({ intervalMs: 10, batchSize: 1 });
    await jest.advanceTimersByTimeAsync(10);
    worker.stop();

    expect(processDue).toHaveBeenCalledWith({ limit: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      '[OutboundWorker] Erro ao processar fila outbound',
      { error: '' }
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/outboundWorker.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
