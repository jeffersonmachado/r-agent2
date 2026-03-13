'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessReplayService } = require('../../api/core/process-runtime/processReplayService');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');

describe('process replay', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('expõe execution path resumido', withTimeout(async () => {
    const replay = new ProcessReplayService();
    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-replay-path',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [{ id: 'start-1', type: 'start' }, { id: 'end-1', type: 'end' }],
      edges: [{ id: 'e1', source: 'start-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const events = [
      { executionId: 'exec-path-1', sequence: 1, processId: 'proc-replay-path', processVersion: 1, nodeId: 'start-1', nodeType: 'start', eventType: 'NODE_ENTER', timestamp: '2026-03-12T10:00:00.000Z' },
      { executionId: 'exec-path-1', sequence: 2, processId: 'proc-replay-path', processVersion: 1, nodeId: 'start-1', nodeType: 'start', eventType: 'NODE_EXIT', timestamp: '2026-03-12T10:00:01.000Z' },
      { executionId: 'exec-path-1', sequence: 3, processId: 'proc-replay-path', processVersion: 1, nodeId: 'end-1', nodeType: 'end', eventType: 'NODE_ENTER', timestamp: '2026-03-12T10:00:02.000Z' },
    ];

    expect(replay.getCurrentStateFromEvents(compiled, events).currentNodeId).toBe('end-1');
    expect(replay.getExecutionPath(events)).toHaveLength(3);
  }, 5000));
});
