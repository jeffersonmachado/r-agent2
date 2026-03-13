'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { InMemoryProcessExecutionRepository } = require('../../api/core/process-runtime/processExecutionRepository');

describe('InMemoryProcessExecutionRepository', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('mantem sequencia monotônica por executionId', withTimeout(async () => {
    const repository = new InMemoryProcessExecutionRepository();
    const seq1 = await repository.getNextSequence('exec-repo-1');
    const seq2 = await repository.getNextSequence('exec-repo-1');

    await repository.appendEvent({
      executionId: 'exec-repo-1',
      sequence: seq1,
      processId: 'proc-1',
      processVersion: 1,
      eventType: 'PROCESS_STARTED',
    });
    await repository.appendEvent({
      executionId: 'exec-repo-1',
      sequence: seq2,
      processId: 'proc-1',
      processVersion: 1,
      eventType: 'PROCESS_COMPLETED',
    });

    const events = await repository.listEventsByExecution('exec-repo-1');
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  }, 5000));

  test('normaliza appendEvent fora de ordem para sequencia monotônica', withTimeout(async () => {
    const repository = new InMemoryProcessExecutionRepository();

    await repository.appendEvent({
      executionId: 'exec-repo-2',
      sequence: 3,
      processId: 'proc-2',
      processVersion: 1,
      eventType: 'PROCESS_STARTED',
    });
    await repository.appendEvent({
      executionId: 'exec-repo-2',
      sequence: 1,
      processId: 'proc-2',
      processVersion: 1,
      eventType: 'NODE_ENTER',
    });

    const events = await repository.listEventsByExecution('exec-repo-2');
    expect(events.map((event) => event.sequence)).toEqual([3, 4]);
  }, 5000));
});
