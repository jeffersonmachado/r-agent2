'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessResumeService } = require('../../api/core/process-runtime/processResumeService');
const { InMemoryProcessInstanceStore } = require('../../api/core/process-runtime/processInstanceStore');

describe('ProcessResumeService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('retoma por correlationKey', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    const runtimeService = {
      resumeProcess: jest.fn(async (executionId, payload) => ({ executionId, payload })),
    };
    const resumeService = new ProcessResumeService({ runtimeService, instanceStore: store });
    await store.createInstance({
      executionId: 'exec-resume-1',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      waitingState: { type: 'message', correlationKey: 'corr-resume', nodeId: 'receive-1' },
    });

    const result = await resumeService.resumeByCorrelationKey('corr-resume', { text: 'ok' });
    expect(runtimeService.resumeProcess).toHaveBeenCalledWith('exec-resume-1', { text: 'ok' });
    expect(result.executionId).toBe('exec-resume-1');
  }, 5000));

  test('rejeita retomada quando waiting type nao corresponde', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    const runtimeService = {
      resumeProcess: jest.fn(async (executionId, payload) => ({ executionId, payload })),
    };
    const resumeService = new ProcessResumeService({ runtimeService, instanceStore: store });
    await store.createInstance({
      executionId: 'exec-resume-2',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'timer-1',
      waitingState: { type: 'timer', nodeId: 'timer-1' },
    });

    await expect(resumeService.resumeHumanTask('exec-resume-2', { approved: true }))
      .rejects
      .toThrow('waiting for timer, not human');
    expect(runtimeService.resumeProcess).not.toHaveBeenCalled();
  }, 5000));

  test('rejeita correlationKey ambiguo', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    const runtimeService = {
      resumeProcess: jest.fn(async (executionId, payload) => ({ executionId, payload })),
    };
    const resumeService = new ProcessResumeService({ runtimeService, instanceStore: store });
    await store.createInstance({
      executionId: 'exec-resume-3a',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      waitingState: { type: 'message', correlationKey: 'corr-dup', nodeId: 'receive-1' },
    });
    await store.createInstance({
      executionId: 'exec-resume-3b',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      waitingState: { type: 'message', correlationKey: 'corr-dup', nodeId: 'receive-1' },
    });

    await expect(resumeService.resumeByCorrelationKey('corr-dup', { text: 'ok' }))
      .rejects
      .toThrow('Multiple waiting instances found for correlationKey: corr-dup');
  }, 5000));
});
