'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessAnalyticsService } = require('../../api/core/process-analytics/processAnalyticsService');
const { ProcessBottleneckService } = require('../../api/core/process-analytics/processBottleneckService');
const { ProcessVersionComparisonService } = require('../../api/core/process-analytics/processVersionComparisonService');

describe('process analytics', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('agrega métricas por processo, nó e gateway', withTimeout(async () => {
    const analytics = new ProcessAnalyticsService();
    const events = [
      { executionId: 'exec-1', sequence: 1, processId: 'proc-a', processVersion: 1, eventType: 'PROCESS_STARTED', timestamp: '2026-03-12T10:00:00.000Z' },
      { executionId: 'exec-1', sequence: 2, processId: 'proc-a', processVersion: 1, nodeId: 'gateway-1', nodeType: 'gateway.exclusive', eventType: 'GATEWAY_DECISION', payload: { chosenNext: 'task-1' }, timestamp: '2026-03-12T10:00:01.000Z' },
      { executionId: 'exec-1', sequence: 3, processId: 'proc-a', processVersion: 1, nodeId: 'task-1', nodeType: 'task.service', eventType: 'NODE_ENTER', timestamp: '2026-03-12T10:00:01.000Z' },
      { executionId: 'exec-1', sequence: 4, processId: 'proc-a', processVersion: 1, nodeId: 'task-1', nodeType: 'task.service', eventType: 'NODE_EXIT', timestamp: '2026-03-12T10:00:03.000Z' },
      { executionId: 'exec-1', sequence: 5, processId: 'proc-a', processVersion: 1, eventType: 'PROCESS_COMPLETED', timestamp: '2026-03-12T10:00:05.000Z' },
      { executionId: 'exec-2', sequence: 1, processId: 'proc-a', processVersion: 2, eventType: 'PROCESS_STARTED', timestamp: '2026-03-12T11:00:00.000Z' },
      { executionId: 'exec-2', sequence: 2, processId: 'proc-a', processVersion: 2, nodeId: 'task-1', nodeType: 'task.service', eventType: 'NODE_ENTER', timestamp: '2026-03-12T11:00:00.000Z' },
      { executionId: 'exec-2', sequence: 3, processId: 'proc-a', processVersion: 2, nodeId: 'task-1', nodeType: 'task.service', eventType: 'NODE_ERROR', timestamp: '2026-03-12T11:00:04.000Z' },
      { executionId: 'exec-2', sequence: 4, processId: 'proc-a', processVersion: 2, eventType: 'PROCESS_FAILED', timestamp: '2026-03-12T11:00:05.000Z' },
    ];

    const report = analytics.buildAnalytics(events);

    expect(report.process.totalExecutions).toBe(2);
    expect(report.process.successRate).toBe(0.5);
    expect(report.process.failureRate).toBe(0.5);
    expect(report.nodes.find((item) => item.nodeId === 'task-1').entries).toBe(2);
    expect(report.gateways[0].pathDistribution['task-1']).toBe(1);
  }, 5000));

  test('identifica gargalos e compara versões', withTimeout(async () => {
    const bottlenecks = new ProcessBottleneckService();
    const comparison = new ProcessVersionComparisonService();
    const top = bottlenecks.identifyBottlenecks([
      { nodeId: 'task-1', averageDurationMs: 900, entries: 3 },
      { nodeId: 'task-2', averageDurationMs: 120, entries: 3 },
    ]);

    const delta = comparison.compareVersions(
      { process: { version: 2, totalExecutions: 10, successRate: 0.9, failureRate: 0.1, averageDurationMs: 1000, p95DurationMs: 1500 } },
      { process: { version: 1, totalExecutions: 8, successRate: 0.75, failureRate: 0.25, averageDurationMs: 1300, p95DurationMs: 2000 } },
    );

    expect(top[0].nodeId).toBe('task-1');
    expect(delta.delta.averageDurationMs).toBe(-300);
    expect(delta.delta.successRate).toBeCloseTo(0.15);
  }, 5000));
});
