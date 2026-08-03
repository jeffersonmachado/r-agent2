'use strict';

describe('pipelineExecutionContext - TTL de execuções terminais', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('remove execuções terminais com mais de 1h e preserva em andamento', () => {
    const ctx = require('../../api/services/pipelineExecutionContext');
    const { _internal } = ctx;
    const { executionRegistry, sweepTerminalExecutions, EXECUTION_TTL_AFTER_TERMINAL_MS } = _internal;

    const finishedOld = ctx.ensureExecutionContext({ executionId: 'exec-finished-old', name: 'a' });
    ctx.updateStatus(finishedOld, 'failed', { reason: 'boom' });
    finishedOld.updatedAt = Date.now() - EXECUTION_TTL_AFTER_TERMINAL_MS - 1000;

    const finishedRecent = ctx.ensureExecutionContext({ executionId: 'exec-finished-recent', name: 'b' });
    ctx.updateStatus(finishedRecent, 'failed', { reason: 'boom' });

    const running = ctx.ensureExecutionContext({ executionId: 'exec-running', name: 'c' });
    ctx.updateStatus(running, 'running', {});
    running.updatedAt = Date.now() - EXECUTION_TTL_AFTER_TERMINAL_MS - 1000;

    const removed = sweepTerminalExecutions();

    expect(removed).toBe(1);
    expect(ctx.getExecutionContext('exec-finished-old')).toBeNull();
    // Terminal recente ainda disponível para polling de status
    expect(ctx.getExecutionContext('exec-finished-recent')).not.toBeNull();
    // Execução em andamento nunca é removida, mesmo antiga
    expect(ctx.getExecutionContext('exec-running')).not.toBeNull();
    expect(executionRegistry.size).toBe(2);
  });

  test('sweeper ignora entradas sem status terminal', () => {
    const ctx = require('../../api/services/pipelineExecutionContext');

    const idle = ctx.ensureExecutionContext({ executionId: 'exec-idle', name: 'x' });
    idle.updatedAt = Date.now() - 10 * 60 * 60 * 1000;

    const removed = ctx._internal.sweepTerminalExecutions();

    expect(removed).toBe(0);
    expect(ctx.getExecutionContext('exec-idle')).not.toBeNull();
  });
});
