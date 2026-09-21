'use strict';

const { selectForRole, selectCoderAndReviewer } = require('../../engine/engineeringRouter/modelSelector');

function model(overrides) {
  return {
    providerId: 'p',
    modelId: 'm',
    roles: ['CODER'],
    capabilities: ['CODING'],
    contextClass: 'STANDARD',
    costClass: 'LOW',
    enabled: true,
    healthy: true,
    hasCredential: true,
    ...overrides,
  };
}

describe('engineeringRouter/modelSelector', () => {
  test('rejeita candidato sem capability exigida', () => {
    const models = [model({ capabilities: ['FRONTEND'] })];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected).toBeNull();
    expect(result.reasonCodes).toContain('NO_QUALIFIED_CANDIDATE');
  });

  test('rejeita provider desabilitado, sem credencial ou não saudável', () => {
    const disabled = selectForRole([model({ enabled: false })], { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(disabled.selected).toBeNull();
    const noCred = selectForRole([model({ hasCredential: false })], { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(noCred.selected).toBeNull();
    const unhealthy = selectForRole([model({ healthy: false })], { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(unhealthy.selected).toBeNull();
  });

  test('seleciona o candidato de menor custo entre qualificados quando não há preferência', () => {
    const models = [
      model({ providerId: 'a', modelId: 'x', costClass: 'HIGH' }),
      model({ providerId: 'b', modelId: 'y', costClass: 'LOW' }),
    ];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'] });
    expect(result.selected).toEqual(expect.objectContaining({ providerId: 'b', modelId: 'y' }));
    expect(result.reasonCodes).toContain('LOWER_COST_AMONG_QUALIFIED');
  });

  test('preferredCostClass tem prioridade sobre custo absoluto', () => {
    const models = [
      model({ providerId: 'a', modelId: 'x', costClass: 'LOW' }),
      model({ providerId: 'b', modelId: 'y', costClass: 'HIGH' }),
    ];
    const result = selectForRole(models, { role: 'CODER', requiredCapabilities: ['CODING'], preferredCostClass: 'HIGH' });
    expect(result.selected.providerId).toBe('b');
    expect(result.reasonCodes).toContain('POLICY_PRIORITY');
  });

  test('independência de provider é aplicada quando há dois providers qualificados', () => {
    const models = [
      model({ providerId: 'a', modelId: 'coder-1', roles: ['CODER'] }),
      model({ providerId: 'b', modelId: 'reviewer-1', roles: ['REVIEWER'], capabilities: ['CODE_REVIEW'] }),
    ];
    const result = selectCoderAndReviewer(models, {
      coderCapabilities: ['CODING'],
      reviewerCapabilities: ['CODE_REVIEW'],
      independentReviewRequired: true,
      policyVersion: '1.0.0',
    });
    expect(result.coder.selected.providerId).toBe('a');
    expect(result.reviewer.selected.providerId).toBe('b');
    expect(result.independentReviewApplied).toBe(true);
    expect(result.reviewer.reasonCodes).toContain('INDEPENDENT_PROVIDER_APPLIED');
  });

  test('registra INDEPENDENT_PROVIDER_UNAVAILABLE e nunca finge independência quando só há um provider', () => {
    const models = [
      model({ providerId: 'a', modelId: 'coder-1', roles: ['CODER', 'REVIEWER'], capabilities: ['CODING', 'CODE_REVIEW'] }),
    ];
    const result = selectCoderAndReviewer(models, {
      coderCapabilities: ['CODING'],
      reviewerCapabilities: ['CODE_REVIEW'],
      independentReviewRequired: true,
      policyVersion: '1.0.0',
    });
    expect(result.coder.selected.providerId).toBe('a');
    // Cai de volta para o mesmo provider (única opção qualificada), mas nunca finge independência.
    expect(result.reviewer.selected.providerId).toBe('a');
    expect(result.independentReviewApplied).toBe(false);
    expect(result.reviewer.reasonCodes).toContain('INDEPENDENT_PROVIDER_UNAVAILABLE');
  });

  test('quando independência não é exigida, reviewer pode ser do mesmo provider livremente', () => {
    const models = [
      model({ providerId: 'a', modelId: 'coder-1', roles: ['CODER', 'REVIEWER'], capabilities: ['CODING', 'CODE_REVIEW'] }),
    ];
    const result = selectCoderAndReviewer(models, {
      coderCapabilities: ['CODING'],
      reviewerCapabilities: ['CODE_REVIEW'],
      independentReviewRequired: false,
      policyVersion: '1.0.0',
    });
    expect(result.reviewer.selected.providerId).toBe('a');
    expect(result.independentReviewApplied).toBe(false);
    expect(result.reviewer.reasonCodes).not.toContain('INDEPENDENT_PROVIDER_UNAVAILABLE');
  });
});
