'use strict';

const { classify } = require('../../engine/engineeringRouter/taskClassifier');

describe('engineeringRouter/taskClassifier', () => {
  test('respeita taskType/risk/scope explícitos sem sobrescrever', () => {
    const result = classify({ taskType: 'FRONTEND', risk: 'LOW', scope: 'SMALL', title: 'corrigir bug crítico de segurança' });
    expect(result.taskType).toBe('FRONTEND');
    expect(result.risk).toBe('LOW');
    expect(result.scope).toBe('SMALL');
    expect(result.overridesRespected).toBe(true);
  });

  test('infere BUG_FIX a partir de uma falha de teste única', () => {
    const result = classify({ title: 'corrigir bug de cálculo' }, { failingTests: ['tests/unit/foo.test.js'] });
    expect(result.taskType).toBe('BUG_FIX');
    expect(result.requiredCapabilities).toEqual(expect.arrayContaining(['CODING', 'DEBUGGING']));
  });

  test('infere COMPLEX_BUG_FIX quando há múltiplas falhas de teste', () => {
    const result = classify({ title: 'investigar falhas' }, { failingTests: ['a.test.js', 'b.test.js'] });
    expect(result.taskType).toBe('COMPLEX_BUG_FIX');
    expect(result.risk).toBe('HIGH');
  });

  test('infere GOVERNANCE a partir de allowedPaths', () => {
    const result = classify({ title: 'ajustar gate', allowedPaths: ['scripts/governance/validate-x.js'] });
    expect(result.taskType).toBe('GOVERNANCE');
  });

  test('capabilities explícitas são complementadas, não substituídas', () => {
    const result = classify({ taskType: 'BUG_FIX', requiredCapabilities: ['FRONTEND'] });
    expect(result.requiredCapabilities).toEqual(expect.arrayContaining(['FRONTEND', 'CODING', 'DEBUGGING']));
  });

  test('recomenda REVIEWER para risco HIGH/CRITICAL', () => {
    const result = classify({ taskType: 'BUG_FIX', risk: 'HIGH' });
    expect(result.recommendedRoles).toContain('REVIEWER');
  });

  test('rejeita taskType inválido mesmo se explícito', () => {
    expect(() => classify({ taskType: 'NAO_EXISTE' })).not.toThrow();
    // taskType inválido explícito é ignorado (tratado como não-explícito) e recai na inferência.
    const result = classify({ taskType: 'NAO_EXISTE', title: 'gerar novo endpoint' });
    expect(result.taskType).not.toBe('NAO_EXISTE');
  });
});
