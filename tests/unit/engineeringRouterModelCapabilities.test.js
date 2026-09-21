'use strict';

const { getModelCapability, listCapabilityEntries, isModelMapped } = require('../../engine/engineeringRouter/modelCapabilities');
const { getProvider } = require('../../engine/aiProviderRegistry');

describe('engineeringRouter/modelCapabilities', () => {
  test('toda entrada mapeada referencia um provider real do registry existente', () => {
    for (const entry of listCapabilityEntries()) {
      const provider = getProvider(entry.providerId);
      expect(provider).not.toBeNull();
      const modelIds = provider.models.map((m) => m.value);
      expect(modelIds).toContain(entry.modelId);
    }
  });

  test('getModelCapability retorna null para modelo não mapeado', () => {
    expect(getModelCapability('openai', 'modelo-inexistente')).toBeNull();
  });

  test('isModelMapped reflete presença real', () => {
    expect(isModelMapped('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(isModelMapped('openai', 'modelo-inexistente')).toBe(false);
  });

  test('pelo menos dois providers distintos suportam o papel REVIEWER (pré-condição de independência)', () => {
    const reviewers = listCapabilityEntries().filter((e) => e.roles.includes('REVIEWER'));
    const providerIds = new Set(reviewers.map((e) => e.providerId));
    expect(providerIds.size).toBeGreaterThanOrEqual(2);
  });
});
