'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Hermeticidade: o pipeline rico grava artefatos em qa/mesh/intelligence/learning/
// (failures.*.json, fixPlans.json, learningMemory.json etc.), consumidos pela
// StabilityPage via /qa/learn/*. Sem redirect, o teste sobrescreve os artefatos
// reais do workspace.
const LEARN_TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-pipeline-test-'));
process.env.QA_MESH_LEARN_DIR = LEARN_TEST_TMP;

const { runLearningPipeline } = require('..');

describe('learning pipeline', () => {
  afterAll(() => {
    delete process.env.QA_MESH_LEARN_DIR;
    fs.rmSync(LEARN_TEST_TMP, { recursive: true, force: true });
  });

  test('executa suggestion-only e gera artefatos principais no dir hermético', () => {
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

    expect(fs.existsSync(path.join(LEARN_TEST_TMP, 'failures.ranked.json'))).toBe(true);
    expect(fs.existsSync(path.join(LEARN_TEST_TMP, 'fixPlans.json'))).toBe(true);
    expect(fs.existsSync(path.join(LEARN_TEST_TMP, 'learningMemory.json'))).toBe(true);
    // suggestion-only: nenhum patch aplicado de verdade
    expect(result.patchExecutions.mode).toBe('suggestion-only');
    expect(result.patchExecutions.executions.every((item) => item.applied === false)).toBe(true);
  });

  test('execução sem falhas gera artefatos vazios coerentes', () => {
    const execution = {
      executionId: `exec-clean-${Date.now()}`,
      results: [{ id: 'scenario-ok', domain: 'core', status: 'passed' }],
    };

    const result = runLearningPipeline(execution, []);
    expect(result.normalized.total).toBe(0);
    expect(result.ranked.totalRanked).toBe(0);
    expect(result.fixPlans.totalPlans).toBe(0);
  });
});
