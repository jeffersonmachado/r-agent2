'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessResumeService } = require('../../api/core/process-runtime/processResumeService');
const { InMemoryProcessInstanceStore } = require('../../api/core/process-runtime/processInstanceStore');

describe('process resume', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('retoma external event por correlationKey', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    const runtimeService = {
      resumeProcess: jest.fn(async (executionId, payload) => ({ executionId, payload })),
    };
    const service = new ProcessResumeService({ runtimeService, instanceStore: store });
    await store.createInstance({
      executionId: 'exec-ext-1',
      processId: 'proc-ext',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'subprocess-1',
      waitingState: { type: 'external_event', correlationKey: 'corr-ext', nodeId: 'subprocess-1' },
    });

    const result = await service.resumeExternalEvent('corr-ext', { ok: true });
    expect(result.executionId).toBe('exec-ext-1');
    expect(runtimeService.resumeProcess).toHaveBeenCalledWith('exec-ext-1', { ok: true, resumeType: 'external_event' });
  }, 5000));
});
