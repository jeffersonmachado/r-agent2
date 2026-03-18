'use strict';

const fs = require('fs');
const path = require('path');

describe('failGeneration coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('tolerates hostile error.message getter and preserves original throw', async () => {
    const updateStatus = jest.fn();
    const createPipelineWs = jest.fn(() => ({ emit: jest.fn() }));
    const emitPipelineStage = jest.fn();

    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/pipelineExecutionContext', () => ({ updateStatus }));
    jest.doMock('../../api/ws/pipelineEmitter', () => ({ createPipelineWs }));
    jest.doMock('../../api/ws/emitPipelineStage', () => ({ emitPipelineStage }));

    const { failGeneration } = require('../../api/services/failGeneration');

    await expect(failGeneration({
      execution: {
        executionId: 'exec-1',
        currentStage: 'rag',
        options: { tenantId: 'tenant-1' },
      },
      error: hostileError,
      extra: { stage: 'rag' },
    })).rejects.toBe(hostileError);

    expect(emitPipelineStage).toHaveBeenCalledWith(
      expect.any(Object),
      'exec-1',
      expect.objectContaining({
        stage: 'rag',
        status: 'error',
        message: 'Falha no pipeline',
      })
    );

    expect(updateStatus).toHaveBeenCalledWith(
      expect.any(Object),
      'failed',
      expect.objectContaining({
        stageStatus: 'error',
        message: '',
      })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/failGeneration.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});