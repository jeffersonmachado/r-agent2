'use strict';

const {
  enqueueExecution,
  updateExecution,
  clearExecutions,
  waitForQueuedExecution,
  isTerminalStatus,
  executionEvents,
} = require('../executionQueue');

describe('executionQueue.waitForQueuedExecution (orientado a evento)', () => {
  beforeEach(() => {
    clearExecutions();
    executionEvents.removeAllListeners('updated');
  });

  afterAll(() => {
    clearExecutions();
    executionEvents.removeAllListeners('updated');
  });

  it('resolve imediatamente quando a execução já está em status terminal', async () => {
    const queued = enqueueExecution('test', {}, async () => new Promise(() => { /* nunca resolve */ }));
    await Promise.resolve(); // deixa o microtask do enqueue marcar 'running'
    updateExecution(queued.executionId, { status: 'completed' });

    const record = await waitForQueuedExecution(queued.executionId, { timeoutMs: 1000 });
    expect(record.executionId).toBe(queued.executionId);
    expect(record.status).toBe('completed');
  });

  it('resolve via evento quando a execução atinge status terminal', async () => {
    const queued = enqueueExecution('test', {}, async () => new Promise(() => { /* nunca resolve */ }));

    const waitPromise = waitForQueuedExecution(queued.executionId, { timeoutMs: 2000 });
    setTimeout(() => updateExecution(queued.executionId, { status: 'running' }), 10);
    setTimeout(() => updateExecution(queued.executionId, { status: 'completed', progress: 100 }), 30);

    const record = await waitPromise;
    expect(record.status).toBe('completed');
    expect(record.progress).toBe(100);
  });

  it('rejeita com EXECUTION_WAIT_TIMEOUT ao estourar o deadline', async () => {
    const queued = enqueueExecution('test', {}, async () => new Promise(() => { /* nunca resolve */ }));

    await expect(waitForQueuedExecution(queued.executionId, { timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'EXECUTION_WAIT_TIMEOUT' });
  });

  it('chama onUpdate a cada atualização da execução', async () => {
    const queued = enqueueExecution('test', {}, async () => new Promise(() => { /* nunca resolve */ }));
    const updates = [];

    const waitPromise = waitForQueuedExecution(queued.executionId, {
      timeoutMs: 2000,
      onUpdate: (record) => updates.push(record.status),
    });
    setTimeout(() => updateExecution(queued.executionId, { status: 'running', progress: 40 }), 10);
    setTimeout(() => updateExecution(queued.executionId, { status: 'failed', error: 'boom' }), 30);

    await waitPromise;
    expect(updates).toContain('running');
    expect(updates).toContain('failed');
  });

  it('ignora eventos de outras execuções', async () => {
    const queued = enqueueExecution('test', {}, async () => new Promise(() => { /* nunca resolve */ }));

    const waitPromise = waitForQueuedExecution(queued.executionId, { timeoutMs: 2000 });
    setTimeout(() => updateExecution('outra-exec', { status: 'completed' }), 10);
    setTimeout(() => updateExecution(queued.executionId, { status: 'cancelled' }), 40);

    const record = await waitPromise;
    expect(record.status).toBe('cancelled');
  });

  it('isTerminalStatus reconhece os status finais', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });
});
