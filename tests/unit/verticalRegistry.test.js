'use strict';

/**
 * FASE 23 — vertical registry duplicate.
 *
 * Regressão do hardening de registries canônicos (HARD-009 / FASE 9):
 * `config/verticals.json` é a fonte única de IDs de verticais/domínios e
 * duplicidades semânticas (ex.: `market` vs `mercado` como IDs distintos)
 * só são permitidas via alias declarado. Testa as funções puras do
 * validador bloqueante scripts/governance/validate-vertical-registry.js.
 */

const {
  buildRegistryIndex,
  createResolver,
  collectDomainUsages,
  crossCheckWaveAliases,
} = require('../../scripts/governance/validate-vertical-registry');

function registryWith(domains) {
  return { domains };
}

const baseEntry = { kind: 'vertical', label: 'Rótulo' };

describe('vertical registry — duplicidade semântica', () => {
  test('IDs canônicos distintos sem alias NÃO resolvem entre si (market ≠ mercado)', () => {
    const index = buildRegistryIndex(registryWith({
      market: { ...baseEntry, label: 'Mercado' },
      mercado: { ...baseEntry, label: 'Mercado (duplicado)' },
    }));
    const resolve = createResolver(index);
    expect(resolve('market')).toBe('market');
    // 'mercado' existe como canônico próprio — é exatamente a duplicidade que
    // o registry proíbe na prática: aqui provamos que sem alias declarado um
    // ID legado NÃO resolve ao canônico.
    const noDup = buildRegistryIndex(registryWith({ market: { ...baseEntry, label: 'Mercado' } }));
    const resolveStrict = createResolver(noDup);
    expect(resolveStrict('mercado')).toBeNull();
  });

  test('alias declarado resolve ao ID canônico', () => {
    const index = buildRegistryIndex(registryWith({
      market: { ...baseEntry, label: 'Mercado', aliases: ['mercado', 'varejo', 'retail'] },
    }));
    const resolve = createResolver(index);
    expect(resolve('mercado')).toBe('market');
    expect(resolve('varejo')).toBe('market');
    expect(resolve('retail')).toBe('market');
    expect(index.errors).toHaveLength(0);
  });

  test('alias que colide com ID canônico é violação', () => {
    const index = buildRegistryIndex(registryWith({
      market: { ...baseEntry, label: 'Mercado', aliases: ['clinic'] },
      clinic: { ...baseEntry, label: 'Clínica' },
    }));
    expect(index.errors.some((e) => e.includes('colide com ID canônico'))).toBe(true);
  });

  test('mesmo alias declarado em dois canônicos é violação (duplicidade não aliasada)', () => {
    const index = buildRegistryIndex(registryWith({
      market: { ...baseEntry, label: 'Mercado', aliases: ['loja'] },
      services: { ...baseEntry, label: 'Serviços', aliases: ['loja'] },
    }));
    expect(index.errors.some((e) => e.includes('duplicidade não aliasada'))).toBe(true);
  });

  test('entrada sem kind/label válidos é violação', () => {
    const index = buildRegistryIndex(registryWith({
      broken: { aliases: [] },
    }));
    expect(index.errors.some((e) => e.includes('kind inválido'))).toBe(true);
    expect(index.errors.some((e) => e.includes('label pt-BR ausente'))).toBe(true);
  });
});

describe('vertical registry — configs reais do repo', () => {
  test('nenhum uso de domínio nas fontes reais fica sem resolução canônica', () => {
    const registry = require('../../config/verticals.json');
    const index = buildRegistryIndex(registry);
    expect(index.errors).toEqual([]);
    const resolve = createResolver(index);
    const unresolved = collectDomainUsages().filter((u) => !resolve(u.id));
    expect(unresolved).toEqual([]);
  });

  test('domainAliases do qa-waves-registry são consistentes com verticals.json', () => {
    const registry = require('../../config/verticals.json');
    const index = buildRegistryIndex(registry);
    expect(crossCheckWaveAliases(index)).toEqual([]);
  });
});
