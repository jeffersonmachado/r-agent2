'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');
const { ProcessOptimizationService } = require('../../api/core/process-intelligence/processOptimizationService');

describe('process intelligence', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('gera gaps e recomendações automáticas', withTimeout(async () => {
    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-opt',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start' },
        { id: 'ai-1', type: 'task.ai', config: { promptTemplate: 'x' } },
        { id: 'gateway-1', type: 'gateway.exclusive' },
        { id: 'end-1', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'ai-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'ai-1', target: 'gateway-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e3', source: 'gateway-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'a' } },
        { id: 'e4', source: 'gateway-1', target: 'ai-1', priority: 1, metadata: { sourcePort: 'b' } },
        { id: 'e5', source: 'gateway-1', target: 'start-1', priority: 2, metadata: { sourcePort: 'c' } },
        { id: 'e6', source: 'gateway-1', target: 'gateway-1', priority: 3, metadata: { sourcePort: 'd' } },
      ],
    });

    const service = new ProcessOptimizationService();
    const result = service.optimize({
      compiledProcess: compiled,
      analytics: { bottlenecks: [{ nodeId: 'ai-1' }] },
      simulation: { complexityScore: 45 },
    });

    expect(result.gaps.some((gap) => gap.type === 'missing_fallback')).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  }, 5000));
});
