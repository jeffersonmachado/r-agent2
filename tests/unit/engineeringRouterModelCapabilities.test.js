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

  // ER-V1-SEAL-005 (Current Model Policy) — OBJETIVO: "corrigir a defasagem entre provider
  // discovery e os modelos realmente elegíveis no Router. NÃO hardcodar automaticamente todo
  // modelo descoberto como confiável." / "NÃO inventar disponibilidade. Se provider não listar
  // um modelo: UNAVAILABLE/UNKNOWN conforme evidence."
  //
  // RED real (não hipotético): este próprio arquivo, `modelCapabilities.js`, já documentava em
  // comentário — desde a missão anterior (ER-V1-FINAL-*) — que um pilot real com credencial
  // OpenAI real confirmou 404 (`model_not_found`/descontinuado) para `openai:gpt-5-codex` e
  // `openai:gpt-5.5-pro` ("a API rejeitou como inexistentes/descontinuados nesta conta"), mas
  // AMBOS continuavam mapeados em `MODEL_CAPABILITIES` com roles CODER/REVIEWER — ou seja, a
  // allowlist de segurança do Router (a autoridade ÚNICA de elegibilidade, via
  // `modelCatalogPolicy.isEligibleForRisk`/`isModelMapped`) afirmava disponibilidade que a
  // evidência real já tinha refutado. Nenhuma invenção de disponibilidade é aceitável aqui: um
  // modelId com evidência real e já registrada de rejeição pelo provider nunca pode permanecer
  // mapeado como se fosse confiável — precisa ser removido da allowlist (queda seguro para
  // UNAVAILABLE/não-elegível, nunca promovido de volta sem nova evidência positiva).
  test('ER-V1-SEAL-005: modelos com evidência real e documentada de rejeição pelo provider (404/descontinuado) nunca permanecem mapeados na allowlist', () => {
    const disprovedByRealEvidence = [
      { providerId: 'openai', modelId: 'gpt-5-codex' },
      { providerId: 'openai', modelId: 'gpt-5.5-pro' },
    ];
    for (const { providerId, modelId } of disprovedByRealEvidence) {
      expect(isModelMapped(providerId, modelId)).toBe(false);
    }
  });

  test('ER-V1-SEAL-005: gpt-4o (único modelo OpenAI com disponibilidade real confirmada no pilot) permanece mapeado como CODER e REVIEWER', () => {
    expect(isModelMapped('openai', 'gpt-4o')).toBe(true);
    const entry = getModelCapability('openai', 'gpt-4o');
    expect(entry.roles).toEqual(expect.arrayContaining(['CODER', 'REVIEWER']));
  });
});
