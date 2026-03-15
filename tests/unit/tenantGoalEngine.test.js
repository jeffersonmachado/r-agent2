'use strict';

const { GoalEngine } = require('../../api/core/tenant-intelligence/GoalEngine');

describe('GoalEngine evaluateGoalStatus', () => {
  test('retorna on_track para gte quando current >= target', () => {
    const engine = new GoalEngine();
    const out = engine.evaluateGoalStatus({
      comparison_mode: 'gte',
      current_value: 120,
      target_value: 100,
    });

    expect(out.computedStatus).toBe('on_track');
    expect(out.progressPercent).toBe(100);
  });

  test('retorna at_risk quando objetivo esta perto do alvo', () => {
    const engine = new GoalEngine();
    const out = engine.evaluateGoalStatus({
      comparison_mode: 'gte',
      current_value: 95,
      target_value: 100,
    });

    expect(out.computedStatus).toBe('at_risk');
    expect(out.progressPercent).toBe(95);
  });

  test('retorna off_track quando performance esta abaixo do limiar', () => {
    const engine = new GoalEngine();
    const out = engine.evaluateGoalStatus({
      comparison_mode: 'gte',
      current_value: 60,
      target_value: 100,
    });

    expect(out.computedStatus).toBe('off_track');
    expect(out.progressPercent).toBe(60);
  });

  test('retorna on_track para lte quando current <= target', () => {
    const engine = new GoalEngine();
    const out = engine.evaluateGoalStatus({
      comparison_mode: 'lte',
      current_value: 8,
      target_value: 10,
    });

    expect(out.computedStatus).toBe('on_track');
  });

  test('retorna unknown quando current_value nao esta definido', () => {
    const engine = new GoalEngine();
    const out = engine.evaluateGoalStatus({
      comparison_mode: 'gte',
      current_value: null,
      target_value: 100,
    });

    expect(out.computedStatus).toBe('unknown');
    expect(out.progressPercent).toBeNull();
  });
});
