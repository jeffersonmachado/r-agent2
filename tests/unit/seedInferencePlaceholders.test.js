'use strict';

/**
 * FASE 15 — DOMAIN_SEEDS hard-coded são placeholders declarativos.
 *
 * Falha coberta (falharia antes da correção): seeds vindos do mapa
 * DOMAIN_SEEDS eram reportados como se fossem geração confiável, sem
 * distinção de natureza. Agora carregam `placeholder: true` e
 * `seedNature: 'declarative_placeholder'` — o report nunca apresenta seed
 * declarativo inicial como geração relacional validada por FK.
 */

const {
  inferDomainSpecificSeeds,
  generateSeedsForCapability,
} = require('../../api/services/qa/seedInferenceService');

describe('seedInferenceService — DOMAIN_SEEDS rotulados como placeholders', () => {
  test('seeds de domínio carregam placeholder=true e seedNature declarativa', () => {
    const seeds = inferDomainSpecificSeeds({ name: 'support_ticket' });
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(seed.placeholder).toBe(true);
      expect(seed.seedNature).toBe('declarative_placeholder');
      expect(seed.inferred).toBe(true);
    }
  });

  test('rotulagem vale para todos os domínios declarativos', () => {
    for (const capability of ['crm_contact', 'fitness_checkin', 'billing_charge', 'turnstile_access']) {
      const seeds = inferDomainSpecificSeeds({ name: capability });
      expect(seeds.length).toBeGreaterThan(0);
      expect(seeds.every((s) => s.placeholder === true && s.seedNature === 'declarative_placeholder')).toBe(true);
    }
  });

  test('generateSeedsForCapability propaga o rótulo para seeds de domínio', () => {
    const seeds = generateSeedsForCapability({ id: 'support_ticket', name: 'support_ticket' });
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every((s) => s.placeholder === true)).toBe(true);
  });
});
