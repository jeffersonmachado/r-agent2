'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessSimulationService } = require('../../api/core/process-simulation/processSimulationService');

describe('process simulation', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('detecta nós inalcançáveis, loops e caminhos terminais', withTimeout(async () => {
    const simulation = new ProcessSimulationService();
    const report = simulation.simulateProcess({
      id: 'proc-sim',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start' },
        { id: 'task-1', type: 'task.service' },
        { id: 'gateway-1', type: 'gateway.exclusive' },
        { id: 'end-1', type: 'end' },
        { id: 'orphan-1', type: 'task.service' },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'task-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'task-1', target: 'gateway-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e3', source: 'gateway-1', target: 'task-1', priority: 0, metadata: { sourcePort: 'retry' } },
        { id: 'e4', source: 'gateway-1', target: 'end-1', priority: 1, metadata: { sourcePort: 'out' } },
      ],
    });

    expect(report.unreachableNodes).toContain('orphan-1');
    expect(report.loops.length).toBeGreaterThan(0);
    expect(report.terminalPaths.length).toBeGreaterThan(0);
    expect(report.complexityScore).toBeGreaterThan(0);
  }, 5000));
});
