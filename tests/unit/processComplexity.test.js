'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessComplexityService } = require('../../api/core/process-simulation/processComplexityService');

describe('process complexity', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('calcula complexity score', withTimeout(async () => {
    const service = new ProcessComplexityService();
    const result = service.calculateComplexity({
      nodeCount: 10,
      edgeCount: 12,
      loopCount: 1,
      branchingNodes: 2,
      unreachableNodeCount: 1,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(result.level);
    expect(result.factors.loopCount).toBe(1);
  }, 5000));
});
