'use strict';

const fs = require('fs');
const path = require('path');
const { runLearningPipeline } = require('..');

describe('learning pipeline', () => {
  test('executa suggestion-only e gera artefatos principais', () => {
    const execution = {
      executionId: `exec-${Date.now()}`,
      results: [
        {
          id: 'scenario-1',
          domain: 'pbx',
          status: 'failed',
          failureType: 'timeout',
          errorMessage: 'tts timeout',
          criticality: 'high',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
    };

    const result = runLearningPipeline(execution, []);
    expect(result).toBeTruthy();
    expect(result.ranked.totalRanked).toBeGreaterThan(0);
    expect(result.fixPlans.totalPlans).toBeGreaterThan(0);

    const learningDir = path.join(process.cwd(), 'qa/mesh/intelligence/learning');
    expect(fs.existsSync(path.join(learningDir, 'failures.ranked.json'))).toBe(true);
    expect(fs.existsSync(path.join(learningDir, 'fixPlans.json'))).toBe(true);
    expect(fs.existsSync(path.join(learningDir, 'learningMemory.json'))).toBe(true);
  });
});
