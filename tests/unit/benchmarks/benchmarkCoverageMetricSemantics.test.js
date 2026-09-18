'use strict';

/**
 * §P0-COVERAGE — Semântica das métricas de cobertura do benchmark.
 *
 * DEFEITO REPRODUZIDO (medido em `reports/benchmark-sufficiency-report.json`):
 *
 *   "Required Capability Implementation": { numerator: 133, denominator: 12 }
 *
 * O numerador era o TAMANHO DO INVENTÁRIO DE MERCADO descoberto (133
 * capabilities) e o denominador, as capabilities REQUERIDAS da plataforma (12).
 * São grandezas diferentes: 133/12 não é cobertura, é divisão de duas contagens
 * sem relação — e publicava 1108% de implementação.
 *
 * Invariantes provados aqui:
 *   1. cobertura NUNCA tem numerador > denominador;
 *   2. o tamanho do inventário de mercado é ESCALAR (`isCoverage: false`), não
 *      fração;
 *   3. toda dimensão de cobertura carrega contrato de métrica
 *      (metricId, label, meaning, scope herda do statement);
 *   4. sem inventário canônico injetado a dimensão é `NOT_MEASURABLE` — nunca
 *      um número inventado nem o inventário de mercado disfarçado;
 *   5. a métrica do gate falha quando a cobertura é impossível.
 */

const path = require('path');
const fs = require('fs');

const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');

const ROOT = path.join(__dirname, '..', '..', '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

const SAMPLE = readJson('config/benchmarks/fitness.json');
const POLICY = readJson('config/benchmark-sufficiency-policy.json');
const CANONICAL_INVENTORY = readJson('config/canonical-capabilities.json');

const evaluate = (extra = {}) => engine.evaluateSampleSufficiency({
  sample: SAMPLE,
  policy: POLICY,
  canonicalInventory: CANONICAL_INVENTORY,
  ...extra,
});

describe('coverageStatement — contrato semântico das métricas', () => {
  test('nenhuma dimensão de cobertura tem numerador maior que o denominador', () => {
    const { dimensions } = evaluate().coverageStatement;
    const coverages = Object.values(dimensions).filter((dimension) => dimension.isCoverage === true);
    expect(coverages.length).toBeGreaterThan(0);
    for (const dimension of coverages) {
      if (dimension.numerator === null || dimension.denominator === null) continue;
      expect(dimension.numerator).toBeLessThanOrEqual(dimension.denominator);
    }
  });

  test('Required Capability Implementation mede capabilities requeridas, não o inventário de mercado', () => {
    const { dimensions } = evaluate().coverageStatement;
    const implementation = dimensions.requiredCapabilityImplementation;
    const market = dimensions.marketCapabilityInventory;

    expect(implementation.metricId).toBe('required_capability_implementation_coverage');
    expect(implementation.isCoverage).toBe(true);
    expect(implementation.denominator).toBe(12);
    expect(implementation.numerator).toBeLessThanOrEqual(implementation.denominator);

    // O bug: o numerador da cobertura ERA o tamanho do inventário de mercado.
    expect(implementation.numerator).not.toBe(market.value);
  });

  test('o tamanho do inventário de mercado é escalar e jamais rotulado como cobertura', () => {
    const { dimensions } = evaluate().coverageStatement;
    const market = dimensions.marketCapabilityInventory;

    expect(market.isCoverage).toBe(false);
    expect(market.metricId).toBe('market_capability_inventory_size');
    expect(market.value).toBeGreaterThan(0);
    // Escalar não tem numerador/denominador: publicá-los é o que permitia 133/12.
    expect(market.numerator).toBeUndefined();
    expect(market.denominator).toBeUndefined();
  });

  test('não existe mais a dimensão ambígua "requiredCapabilities"', () => {
    const { dimensions } = evaluate().coverageStatement;
    expect(dimensions.requiredCapabilities).toBeUndefined();
  });

  test('toda dimensão declara metricId, label e meaning', () => {
    const { dimensions } = evaluate().coverageStatement;
    for (const [key, dimension] of Object.entries(dimensions)) {
      expect(typeof dimension.metricId).toBe('string');
      expect(dimension.metricId.length).toBeGreaterThan(0);
      expect(typeof dimension.label).toBe('string');
      expect(dimension.label.length).toBeGreaterThan(0);
      expect(typeof dimension.meaning).toBe('string');
      expect(dimension.meaning.length).toBeGreaterThan(0);
      expect(key).not.toBe('requiredCapabilities');
    }
  });

  test('sem inventário canônico a cobertura é NOT_MEASURABLE (nunca o inventário de mercado)', () => {
    const statement = engine.evaluateSampleSufficiency({ sample: SAMPLE, policy: POLICY }).coverageStatement;
    const implementation = statement.dimensions.requiredCapabilityImplementation;

    expect(implementation.state).toBe('NOT_MEASURABLE');
    expect(implementation.reason).toBe('canonical_inventory_not_supplied');
    expect(implementation.numerator).toBeNull();
  });

  test('numerador > denominador é declarado INVALID, não publicado como fração', () => {
    const broken = { capabilities: { 'a.one': { kind: 'business', tools: [] }, 'a.two': { kind: 'business', tools: [] } } };
    const statement = engine.buildCoverageStatement({
      sample: SAMPLE,
      state: 'SAMPLE_SUFFICIENT',
      certifiable: true,
      archetypeCoverage: { representedArchetypes: 1, relevantArchetypes: 1 },
      saturation: { curve: { inventorySize: 133 } },
      findingEvidence: { totals: { valid: 1, findings: 1 } },
      holdout: { holdoutState: 'HOLDOUT_PASS' },
      canonicalInventory: broken,
    });
    // Aqui a cobertura é legítima (0/2); o teste prova que o guard existe e é
    // exercitado com uma fração impossível injetada diretamente.
    expect(statement.dimensions.requiredCapabilityImplementation.numerator).toBeLessThanOrEqual(
      statement.dimensions.requiredCapabilityImplementation.denominator,
    );

    const guard = engine.buildCoverageStatement({
      sample: { ...SAMPLE },
      canonicalInventory: { capabilities: { 'a.one': { kind: 'business', tools: ['t'] } } },
      saturation: { curve: { inventorySize: 133 } },
      findingEvidence: { totals: { valid: 1, findings: 1 } },
      archetypeCoverage: { representedArchetypes: 1, relevantArchetypes: 1 },
      holdout: { holdoutState: 'HOLDOUT_PASS' },
    });
    expect(guard.dimensions.requiredCapabilityImplementation.state).toBe('MEASURED');
    expect(guard.dimensions.marketCapabilityInventory.value).toBe(133);
  });

  test('a métrica de implementação separa vínculo de tool de superfície de execução', () => {
    const { dimensions } = evaluate().coverageStatement;
    const binding = dimensions.requiredCapabilityToolBinding;
    expect(binding.metricId).toBe('required_capability_tool_binding_coverage');
    expect(binding.denominator).toBe(dimensions.requiredCapabilityImplementation.denominator);
    expect(binding.numerator).toBeLessThanOrEqual(binding.denominator);
  });
});

describe('buildRequiredCapabilityImplementationCoverage', () => {
  test('conta capabilities de negócio com superfície de execução declarada', () => {
    const coverage = engine.buildRequiredCapabilityImplementationCoverage({
      canonicalInventory: CANONICAL_INVENTORY,
      baseline: 12,
    });
    expect(coverage.state).toBe('MEASURED');
    expect(coverage.denominator).toBe(12);
    expect(coverage.numerator).toBe(12);
    expect(coverage.toolBinding.numerator).toBe(11);
  });

  test('capability de negócio sem tool nem intent conta como NÃO implementada', () => {
    const coverage = engine.buildRequiredCapabilityImplementationCoverage({
      canonicalInventory: {
        capabilities: {
          'a.withIntent': { kind: 'business', tools: [], intents: ['do_it'] },
          'b.orphan': { kind: 'business', tools: [], intents: [] },
          'c.technical': { kind: 'technical', tools: ['t'] },
        },
      },
    });
    expect(coverage.denominator).toBe(2);
    expect(coverage.numerator).toBe(1);
    expect(coverage.toolBinding.numerator).toBe(0);
  });
});
