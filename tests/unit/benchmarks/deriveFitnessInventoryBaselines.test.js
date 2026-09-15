'use strict';

/**
 * T-S1 — baselines canônicos de jornada/regra de negócio do sample Fitness são
 * DERIVADOS dos inventários canônicos da plataforma (nunca digitados), com
 * proveniência por item, de forma determinística, e o engine passa a medir os
 * eixos (MEASURABLE) em vez de reportar BASELINE_UNKNOWN.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  deriveBaselines,
  applyBaselines,
  sectionsEqual,
  ERROR_CODES,
} = require('../../../scripts/benchmark/derive-fitness-inventory-baselines');
const { evaluateSaturation } = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');

const ROOT = path.join(__dirname, '..', '..', '..');

function loadSources() {
  return {
    capabilities: require('../../../config/canonical-capabilities.json'),
    journeys: require('../../../config/business-journey-catalog.json'),
    journeyCriticality: require('../../../config/journey-criticality.json'),
    normalization: require('../../../config/benchmark-normalization.json'),
  };
}

const POLICY = require('../../../config/benchmark-sufficiency-policy.json');

describe('T-S1 — derivação dos baselines canônicos do sample fitness', () => {
  test('derivação é determinística (mesma entrada → mesma saída byte a byte)', () => {
    const sources = loadSources();
    const first = deriveBaselines({ vertical: 'fitness', ...sources });
    const second = deriveBaselines({ vertical: 'fitness', ...sources });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('baselines derivados batem com os inventários canônicos reais', () => {
    const sources = loadSources();
    const baselines = deriveBaselines({ vertical: 'fitness', ...sources });

    const expectedCapabilities = Object.keys(sources.capabilities.capabilities)
      .filter((id) => sources.capabilities.capabilities[id].kind === 'business');
    expect(baselines.canonicalInventoryBaseline).toBe(expectedCapabilities.length);
    expect(baselines.canonicalCapabilityInventory).toHaveLength(expectedCapabilities.length);

    const expectedJourneys = Object.keys(sources.journeys.journeys)
      .filter((id) => id.startsWith('fitness_'));
    expect(baselines.canonicalJourneyInventoryBaseline).toBe(expectedJourneys.length);
    expect(baselines.canonicalJourneyInventory.map((j) => j.id).sort()).toEqual(expectedJourneys.sort());

    const expectedRules = [...new Set(
      sources.normalization.rules
        .filter((rule) => rule.kind === 'businessRule')
        .map((rule) => rule.canonicalId),
    )];
    expect(baselines.canonicalBusinessRuleInventoryBaseline).toBe(expectedRules.length);
    expect(baselines.canonicalBusinessRuleInventory.map((r) => r.id).sort()).toEqual(expectedRules.sort());
  });

  test('cada item carrega proveniência (arquivo fonte + id + versão)', () => {
    const baselines = deriveBaselines({ vertical: 'fitness', ...loadSources() });
    for (const item of baselines.canonicalJourneyInventory) {
      expect(item.provenance.source).toBe('config/business-journey-catalog.json');
      expect(item.provenance.id).toBe(item.id);
    }
    for (const item of baselines.canonicalBusinessRuleInventory) {
      expect(item.provenance.source).toBe('config/benchmark-normalization.json');
      expect(item.provenance.id).toBe(item.id);
      expect(item.provenance.version).toBeTruthy();
    }
    for (const item of baselines.canonicalCapabilityInventory) {
      expect(item.provenance.source).toBe('config/canonical-capabilities.json');
    }
    // Criticidade da jornada blocking vem do registry declarativo real.
    const checkin = baselines.canonicalJourneyInventory.find((j) => j.id === 'fitness_customer_checkin');
    expect(checkin.criticality).toBe('blocking');
    expect(checkin.provenance.criticalitySource).toBe('config/journey-criticality.json');
  });

  test('recusa fonte canônica ausente (baseline_source_missing)', () => {
    const sources = loadSources();
    expect(() => deriveBaselines({ vertical: 'fitness', ...sources, journeys: null }))
      .toThrow(expect.objectContaining({ code: ERROR_CODES.SOURCE_EMPTY }));
    expect(() => deriveBaselines({ vertical: 'fitness', ...sources, normalization: { rules: [] } }))
      .toThrow(expect.objectContaining({ code: ERROR_CODES.SOURCE_EMPTY }));
    expect(() => deriveBaselines({ vertical: 'fitness', ...sources, capabilities: { capabilities: {} } }))
      .toThrow(expect.objectContaining({ code: ERROR_CODES.SOURCE_EMPTY }));
  });

  test('recusa catálogo sem jornadas da vertical (nunca inventa baseline 0)', () => {
    const sources = loadSources();
    expect(() => deriveBaselines({ vertical: 'vertical-inexistente', ...sources }))
      .toThrow(expect.objectContaining({ code: ERROR_CODES.SOURCE_EMPTY }));
  });

  test('o sample versionado está em sincronia com as fontes (modo check)', () => {
    const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));
    const baselines = deriveBaselines({ vertical: 'fitness', ...loadSources() });
    expect(sectionsEqual(sample, baselines)).toBe(true);
  });

  test('applyBaselines toca apenas as chaves gerenciadas', () => {
    const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));
    const baselines = deriveBaselines({ vertical: 'fitness', ...loadSources() });
    const mutated = { ...sample, benchmarks: [{ id: 'x' }], archetypes: [] };
    const next = applyBaselines(mutated, baselines);
    expect(next.benchmarks).toEqual([{ id: 'x' }]);
    expect(next.archetypes).toEqual([]);
    expect(mutated.canonicalJourneyInventoryBaseline).toBe(sample.canonicalJourneyInventoryBaseline);
  });

  test('o engine lê os novos baselines como MEASURABLE (não BASELINE_UNKNOWN)', () => {
    const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));
    const analyzed = (id) => ({
      analyzedAt: '2026-09-15T00:00:00.000Z',
      researchVersion: 'test',
      findingsInventory: [],
      sources: [{ url: `https://${id}.example.com/features`, tier: 5, verified: true, httpStatus: 200 }],
      novelty: {},
    });
    const measured = {
      ...sample,
      benchmarks: sample.benchmarks.map((b) => (b.role === 'discovery' ? { ...b, ...analyzed(b.id) } : b)),
    };

    const evaluation = evaluateSaturation({ sample: measured, policy: POLICY });
    // Pesquisa executada com ZERO novidade medida é um resultado legítimo:
    // os três eixos passam a ser MEASURED (cada ponto da janela tem denominador
    // canônico próprio) em vez de NOT_MEASURABLE por baseline ausente.
    for (const gate of [evaluation.capability, evaluation.journey, evaluation.businessRule]) {
      expect(gate.baselineState).toBe('DECLARED');
      expect(gate.windowPoints.every((point) => point.rateState === 'MEASURED')).toBe(true);
      expect(gate.status).toBe('PASS');
    }
  });

  test('baseline ausente continua NOT_MEASURABLE (a derivacão não apaga a honestidade)', () => {
    const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));
    delete sample.canonicalJourneyInventoryBaseline;
    const analyzed = {
      ...sample,
      benchmarks: sample.benchmarks.map((b) => (b.role === 'discovery'
        ? {
          ...b,
          analyzedAt: '2026-09-15T00:00:00.000Z',
          researchVersion: 'test',
          findingsInventory: [],
          sources: [{ url: `https://${b.id}.example.com/features`, tier: 5, verified: true, httpStatus: 200 }],
          novelty: {},
        }
        : b)),
    };
    const evaluation = evaluateSaturation({ sample: analyzed, policy: POLICY });
    expect(evaluation.journey.baselineState).toBe('UNKNOWN');
    expect(evaluation.journey.status).toBe('NOT_MEASURABLE');
  });

  test('modo check via CLI falha quando o sample diverge das fontes', () => {
    const { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-baseline-'));
    const drifted = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));
    drifted.canonicalJourneyInventoryBaseline = 999;
    // Simula drift escrevendo sample adulterado e comparando as seções.
    const baselines = deriveBaselines({ vertical: 'fitness', ...loadSources() });
    expect(sectionsEqual(drifted, baselines)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
    // E o arquivo real passa no --check.
    const out = execFileSync('node', ['scripts/benchmark/derive-fitness-inventory-baselines.js', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/OK/);
  });
});
