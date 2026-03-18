'use strict';

/**
 * Coercion-guard tests for pipelineExecutionContext.js
 * Verifies hostile err.message getters in best-effort catch blocks don't crash.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn(),
}));
jest.mock('../../api/services/websocketService', () => ({
  emitEvent: jest.fn(),
}));

const { updateStage, updateStatus, createExecutionContext } = require('../../api/services/pipelineExecutionContext');
const { emitEvent } = require('../../api/services/websocketService');

const hostileErr = () => {
  const e = new Error('real');
  Object.defineProperty(e, 'message', { get() { throw new Error('hostile message'); } });
  return e;
};

const hostileErrFull = () => ({
  get message() {
    throw new Error('hostile message');
  },
  toString() {
    throw new Error('hostile toString');
  },
});

describe('pipelineExecutionContext – coercion guards', () => {
  beforeEach(() => {
    emitEvent.mockReset();
  });

  test('updateStage: hostile err.message in WS emit catch does not throw', async () => {
    emitEvent.mockImplementation(() => { throw hostileErr(); });
    const exec = createExecutionContext({ executionId: 'exec-test-1' }, { tenantId: 't1' });
    // updateStage catches WS emit errors best-effort; hostile message must not crash
    expect(() => updateStage(exec, 'ingestion', 'completed')).not.toThrow();
  });

  test('finalizeExecution: hostile err.message in WS emit catch does not throw', async () => {
    emitEvent.mockImplementation(() => { throw hostileErr(); });
    const exec = createExecutionContext({ executionId: 'exec-test-2' }, { tenantId: 't1' });
    // updateStatus catches WS emit errors best-effort; hostile message must not crash
    expect(() => updateStatus(exec, 'failed', {})).not.toThrow();
  });

  test('updateStage/updateStatus: hostile err.message and toString in WS emit catch do not throw', async () => {
    emitEvent.mockImplementation(() => { throw hostileErrFull(); });
    const exec = createExecutionContext({ executionId: 'exec-test-3' }, { tenantId: 't1' });

    expect(() => updateStage(exec, 'ingestion', 'completed')).not.toThrow();
    expect(() => updateStatus(exec, 'failed', {})).not.toThrow();
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/pipelineExecutionContext.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
