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

  test('appendEvent tolera payload e metadata hostis com fallback seguro', withTimeout(async () => {
    const repository = new InMemoryProcessExecutionRepository();
    const { proxy: hostilePayload, revoke: revokePayload } = Proxy.revocable({ a: 1 }, {});
    revokePayload();
    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ source: 'x' }, {});
    revokeMetadata();

    const saved = await repository.appendEvent({
      executionId: 'exec-repo-hostile',
      sequence: 1,
      processId: 'proc-hostile',
      processVersion: 1,
      eventType: 'NODE_ENTER',
      payload: hostilePayload,
      metadata: hostileMetadata,
    });

    expect(saved.executionId).toBe('exec-repo-hostile');
    expect(saved.sequence).toBe(1);
    expect(saved.payload).toEqual({});
    expect(saved.metadata).toEqual({});
  }, 5000));

  test('appendEvents tolera array revogado sem lançar', withTimeout(async () => {
    const repository = new InMemoryProcessExecutionRepository();
    const { proxy: hostileEvents, revoke } = Proxy.revocable([
      {
        executionId: 'exec-repo-batch',
        sequence: 1,
        processId: 'proc-batch',
        processVersion: 1,
        eventType: 'PROCESS_STARTED',
      },
    ], {});
    revoke();

    const saved = await repository.appendEvents(hostileEvents);
    const listed = await repository.listEventsByExecution('exec-repo-batch');

    expect(saved).toEqual([]);
    expect(listed).toEqual([]);
  }, 5000));

  test('listEventsByExecution tolera executionId hostil e retorna vazio', withTimeout(async () => {
    const repository = new InMemoryProcessExecutionRepository();
    await repository.appendEvent({
      executionId: 'exec-repo-safe',
      sequence: 1,
      processId: 'proc-safe',
      processVersion: 1,
      eventType: 'PROCESS_STARTED',
    });

    const { proxy: hostileExecutionId, revoke } = Proxy.revocable({ value: 'exec-repo-safe' }, {});
    revoke();

    const listed = await repository.listEventsByExecution(hostileExecutionId);
    expect(listed).toEqual([]);
  }, 5000));
});
