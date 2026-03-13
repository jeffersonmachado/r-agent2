'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessReplayService } = require('../../api/core/process-runtime/processReplayService');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');

describe('ProcessReplayService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('reconstrói estado lógico a partir de eventos', withTimeout(async () => {
    const replay = new ProcessReplayService();
    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-replay',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [{ id: 'start-1', type: 'start' }, { id: 'receive-1', type: 'task.message.receive' }],
      edges: [{ id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const events = [
      { executionId: 'exec-replay-1', sequence: 1, processId: 'proc-replay', processVersion: 1, eventType: 'PROCESS_STARTED', payload: {} },
      { executionId: 'exec-replay-1', sequence: 2, processId: 'proc-replay', processVersion: 1, nodeId: 'start-1', nodeType: 'start', eventType: 'NODE_EXIT', payload: { currentNodeId: 'receive-1', variablesSnapshot: { a: 1 }, historySnapshot: [] } },
      { executionId: 'exec-replay-1', sequence: 3, processId: 'proc-replay', processVersion: 1, nodeId: 'receive-1', nodeType: 'task.message.receive', eventType: 'NODE_WAITING', payload: { currentNodeId: 'receive-1', variablesSnapshot: { a: 1 }, historySnapshot: [], waitingState: { type: 'message', nodeId: 'receive-1', correlationKey: 'corr-r' } } },
    ];

    const context = replay.rebuildContextFromEvents(compiled, events);
    expect(context.status).toBe('waiting');
    expect(context.currentNodeId).toBe('receive-1');
    expect(context.waitingState).toMatchObject({ type: 'message', correlationKey: 'corr-r' });
  }, 5000));

  test('replay limpa waiting state ao sair do nó e preserva nextNodeId', withTimeout(async () => {
    const replay = new ProcessReplayService();
    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-replay-2',
      version: 2,
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start' },
        { id: 'receive-1', type: 'task.message.receive' },
        { id: 'end-1', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'receive-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const events = [
      { executionId: 'exec-replay-2', sequence: 1, processId: 'proc-replay-2', processVersion: 2, eventType: 'PROCESS_STARTED', payload: {} },
      { executionId: 'exec-replay-2', sequence: 2, processId: 'proc-replay-2', processVersion: 2, nodeId: 'receive-1', nodeType: 'task.message.receive', eventType: 'NODE_WAITING', payload: { currentNodeId: 'receive-1', variablesSnapshot: { a: 1 }, historySnapshot: [], waitingState: { type: 'message', nodeId: 'receive-1', correlationKey: 'corr-r2' } } },
      { executionId: 'exec-replay-2', sequence: 3, processId: 'proc-replay-2', processVersion: 2, nodeId: 'receive-1', nodeType: 'task.message.receive', eventType: 'NODE_EXIT', payload: { currentNodeId: 'receive-1', nextNodeId: 'end-1', variablesSnapshot: { a: 1, answer: 'ok' }, historySnapshot: [{ role: 'user', type: 'message', text: 'ok' }] } },
    ];

    const context = replay.rebuildContextFromEvents(compiled, events);
    expect(context.status).toBe('running');
    expect(context.currentNodeId).toBe('end-1');
    expect(context.waitingState).toBeNull();
    expect(context.variables.answer).toBe('ok');
  }, 5000));
});
