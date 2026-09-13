'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('qaService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getQaHistory returns [] when telemetry throws hostile message getter error', () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../qa/qaRunner', () => ({ runQa: jest.fn() }));
    jest.doMock('../../api/services/qaTelemetry', () => ({
      readQaResults: jest.fn(() => {
        throw hostileError;
      }),
      getQaStats: jest.fn(() => ({ total: 0 })),
    }));
    jest.doMock('../../lib/replaySystem', () => ({ ReplaySystem: jest.fn() }));
    jest.doMock('../../lib/recordingSystem', () => ({ RecordingSystem: jest.fn() }));

    const svc = require('../../api/services/qaService');
    const out = svc.getQaHistory({ limit: 10, source: 'runtime' });

    expect(out).toEqual([]);
  });

  test('runQaManual handles hostile error object in catch path without secondary crash', () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const replayMock = {
      start: jest.fn(),
      recordEvent: jest.fn(),
      recordAction: jest.fn(),
      recordError: jest.fn(),
      stop: jest.fn(),
      save: jest.fn(() => 'replay-path'),
    };

    const recordingMock = {
      start: jest.fn(),
      recordAction: jest.fn(),
      recordCustom: jest.fn(),
      stop: jest.fn(),
      save: jest.fn(() => 'recording-path'),
    };

    jest.doMock('../../qa/qaRunner', () => ({
      runQa: jest.fn(() => {
        throw hostileError;
      }),
    }));
    jest.doMock('../../api/services/qaTelemetry', () => ({
      readQaResults: jest.fn(() => []),
      getQaStats: jest.fn(() => ({ total: 0 })),
    }));
    jest.doMock('../../lib/replaySystem', () => ({
      ReplaySystem: jest.fn(() => replayMock),
    }));
    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: jest.fn(() => recordingMock),
    }));

    const svc = require('../../api/services/qaService');

    let thrown;
    try {
      svc.runQaManual({ source: 'manual' });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(hostileError);
    expect(replayMock.recordEvent).toHaveBeenCalledWith('qa_execution_failed', {
      error: 'Erro ao executar QA manual',
    });
    expect(recordingMock.recordCustom).toHaveBeenCalledWith('error', {
      step: 'qa-execution-error',
      value: { error: 'Erro ao executar QA manual' },
    });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/qaService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
