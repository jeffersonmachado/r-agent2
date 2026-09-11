'use strict';

/**
 * BENCHMARK SAMPLE SUFFICIENCY — demonstração do defeito (TEST-FIRST).
 *
 * Defeito: o RAP hoje reporta cobertura de vertical em percentual (ex.: 100%)
 * calculado sobre o PRÓPRIO inventário local, sem nenhuma validação do universo
 * de mercado que esse inventário pretende representar. Nada no repositório
 * responde "100% de qual universo?" nem "qual a evidência de que esse universo
 * é suficientemente representativo?".
 *
 * Estes testes descrevem o comportamento exigido. Eles falham enquanto o
 * mecanismo não existir (RED) e passam quando o gate estiver implementado.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

const POLICY_PATH = path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json');
const ENGINE_PATH = path.join(REPO_ROOT, 'qa', 'benchmarks', 'benchmarkSufficiencyEngine.js');
const REPORT_PATH = path.join(REPO_ROOT, 'reports', 'benchmark-sufficiency-report.json');
const COVERAGE_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'coverage-completeness-report.json');

/**
 * Os relatórios são ARTEFATOS DE GATE (gitignored), não fixtures. Para o teste
 * ser determinístico em qualquer clone, ele MESMO executa os gates reais quando
 * os artefatos não existem — provando que a cadeia os produz.
 */
function ensureGateArtifacts() {
  if (!fs.existsSync(REPORT_PATH)) {
    execFileSync(process.execPath, ['scripts/governance/validate-benchmark-sufficiency.js'], { cwd: REPO_ROOT, stdio: 'ignore' });
  }
  if (!fs.existsSync(COVERAGE_REPORT_PATH)) {
    execFileSync('npm', ['run', 'validate:coverage-completeness', '--silent'], { cwd: REPO_ROOT, stdio: 'ignore' });
  }
}

beforeAll(() => {
  ensureGateArtifacts();
}, 180000);

const SAMPLE_SUFFICIENCY_STATES = [
  'SAMPLE_NOT_RESEARCHED',
  'SAMPLE_RESEARCHING',
  'SAMPLE_NOT_SATURATED',
  'SAMPLE_HOLDOUT_FAILED',
  'SAMPLE_REVALIDATION_REQUIRED',
  'SAMPLE_SUFFICIENT',
];

describe('Benchmark Sample Sufficiency — mecanismo existe e é determinístico', () => {
  it('existe política de governança versionada (thresholds fora do código)', () => {
    expect(fs.existsSync(POLICY_PATH)).toBe(true);
    const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    expect(typeof policy.version).toBe('string');
    // §9/§15: thresholds são POLÍTICA, com rationale registrado, nunca constante científica.
    expect(policy.saturationWindow).toBeGreaterThan(0);
    expect(typeof policy.maxNoncriticalCapabilityNoveltyRate).toBe('number');
    expect(typeof policy.maxHoldoutNoncriticalNoveltyRate).toBe('number');
    expect(policy.rationale).toBeDefined();
    expect(Object.keys(policy.rationale).length).toBeGreaterThan(0);
  });

  it('existe engine puro de suficiência (sem I/O)', () => {
    expect(fs.existsSync(ENGINE_PATH)).toBe(true);
    const engine = require(ENGINE_PATH);
    for (const fn of [
      'evaluateArchetypeCoverage',
      'evaluateDiversity',
      'evaluateIndependence',
      'buildDiscoveryCurve',
      'evaluateSaturation',
      'evaluateHoldout',
      'evaluateLeaveOneOut',
      'evaluateOrderSensitivity',
      'evaluateSourceQuality',
      'evaluateFreshness',
      'detectCorrelatedCloneBenchmarks',
      'evaluateSampleSufficiency',
    ]) {
      expect(typeof engine[fn]).toBe('function');
    }
  });

  it('a taxonomia de estados é a da missão (§39)', () => {
    const engine = require(ENGINE_PATH);
    expect(engine.SAMPLE_STATES).toEqual(expect.objectContaining(
      Object.fromEntries(SAMPLE_SUFFICIENCY_STATES.map((s) => [s.replace('SAMPLE_', ''), s])),
    ));
  });

  it('o gate é executável pela cadeia real de governança (npm), não um script isolado', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(typeof pkg.scripts['validate:benchmark-sufficiency']).toBe('string');
  });
});

describe('Nenhum "100%" de vertical sem universo validado (§37 e §50)', () => {
  it('o relatório de cobertura por vertical separa inventário local de cobertura de mercado', () => {
    expect(fs.existsSync(COVERAGE_REPORT_PATH)).toBe(true);
    const report = JSON.parse(fs.readFileSync(COVERAGE_REPORT_PATH, 'utf8'));
    // O agregado por domínio/vertical vive em `businessAnalysis`.
    const entries = Object.values(report.businessAnalysis || {});
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      // Cada vertical precisa declarar de qual universo o percentual fala.
      expect(entry.sampleSufficiency).toBeDefined();
      expect(SAMPLE_SUFFICIENCY_STATES).toContain(entry.sampleSufficiency.status);
      expect(entry.marketCoverage).toBeDefined();

      // A REGRA: cobertura de MERCADO só existe com amostra provada suficiente.
      // O percentual local continua sendo reportado, mas com escopo explícito —
      // não pode ser apresentado como cobertura de mercado.
      if (entry.marketCoverage.percentage !== null) {
        expect(entry.sampleSufficiency.status).toBe('SAMPLE_SUFFICIENT');
        expect(entry.marketCoverage.certifiable).toBe(true);
      } else {
        expect(entry.marketCoverage.certifiable).toBe(false);
        // Quando o inventário local está 100% e a amostra não está provada, o
        // relatório é obrigado a NÃO apresentar o número como cobertura.
        expect(entry.localInventoryPercentage).toBeDefined();
      }
    }
  });

  it('o relatório de suficiência existe e cobre as verticais registradas', () => {
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    expect(typeof report.generatedAt).toBe('string');
    expect(report.policyVersion).toBeDefined();
    expect(Array.isArray(report.verticals)).toBe(true);

    const registered = Object.entries(
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'verticals.json'), 'utf8')).domains || {},
    ).filter(([, def]) => def.kind === 'vertical').map(([id]) => id);

    for (const verticalId of registered) {
      expect(report.verticals.some((v) => v.vertical === verticalId)).toBe(true);
    }

    for (const vertical of report.verticals) {
      expect(SAMPLE_SUFFICIENCY_STATES).toContain(vertical.status);
      // Vertical sem arquivo de amostra entra como NÃO PESQUISADA — ausência de
      // amostra é um estado explícito, nunca um silêncio.
      if (vertical.sampleFilePresent === false) {
        expect(vertical.status).toBe('SAMPLE_NOT_RESEARCHED');
        expect(vertical.certifiable).toBe(false);
      } else {
        expect(typeof vertical.sampleVersion).toBe('string');
      }
    }
  });
});

describe('Anti-gaming: amostra de logos não pode certificar (§43)', () => {
  const { evaluateSampleSufficiency } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));

  function baseSample(overrides = {}) {
    return {
      vertical: 'test',
      sampleVersion: 'test-v1',
      inventoryVersion: 'inv-1',
      archetypes: [
        { id: 'a1', importance: 'REQUIRED', status: 'ACTIVE' },
        { id: 'a2', importance: 'REQUIRED', status: 'ACTIVE' },
      ],
      benchmarks: [],
      ...overrides,
    };
  }

  it('10 benchmarks do MESMO arquétipo ⇒ FAIL', () => {
    const benchmarks = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      archetype: 'a1',
      independenceGroup: `g${i}`,
      role: i === 0 ? 'discovery' : 'discovery',
      order: i + 1,
      sources: [{ tier: 1, url: 'https://x', retrievedAt: '2026-09-01' }],
      freshness: { researchedAt: '2026-09-01', status: 'FRESH' },
      novelty: { newCapabilities: [], newRequiredCapabilities: [], newCriticalCapabilities: [], newJourneys: [], newRequiredJourneys: [], newCriticalJourneys: [], newBusinessRules: [], newRequiredBusinessRules: [], newCriticalBusinessRules: [] },
    }));
    const result = evaluateSampleSufficiency({ sample: baseSample({ benchmarks }), policy });
    expect(result.status).not.toBe('SAMPLE_SUFFICIENT');
    expect(result.gates.marketArchetypeCoverage.status).toBe('FAIL');
  });

  it('5 benchmarks bem distribuídos, saturados, com holdout independente limpo ⇒ pode ser PASS', () => {
    const mk = (id, archetype, group, order, role, geography, noveltyOverride = {}) => ({
      id, archetype, independenceGroup: group, order, role,
      analyzedAt: '2026-09-01T00:00:00.000Z',
      inventoryVersion: 'inv-1',
      previousInventorySize: order === 1 ? 0 : 1,
      sources: [{ tier: 1, url: 'https://oficial', retrievedAt: '2026-09-01', verified: true }],
      freshness: { researchedAt: '2026-09-01', status: 'FRESH' },
      dimensions: { marketArchetype: archetype, geography },
      novelty: {
        newCapabilities: [], newRequiredCapabilities: [], newCriticalCapabilities: [],
        newJourneys: [], newRequiredJourneys: [], newCriticalJourneys: [],
        newBusinessRules: [], newRequiredBusinessRules: [], newCriticalBusinessRules: [],
        ...noveltyOverride,
      },
    });
    const benchmarks = [
      mk('b1', 'a1', 'g1', 1, 'discovery', 'BR', { newCapabilities: ['cap-1'] }),
      mk('b2', 'a2', 'g2', 2, 'discovery', 'US'),
      mk('b3', 'a1', 'g3', 3, 'discovery', 'BR'),
      mk('b4', 'a2', 'g4', 4, 'discovery', 'US'),
      mk('b5', 'a1', 'g5', 5, 'discovery', 'BR'),
      mk('h1', 'a2', 'g6', 6, 'validation', 'US'),
    ];
    const s = baseSample({
      benchmarks,
      canonicalInventoryBaseline: 1,
      holdout: { benchmarkId: 'h1', selectedAsHoldoutAt: '2026-08-01', selectionReason: 'pré-registrado', selectionEvidence: 'doc', marketArchetype: 'a2', inventoryVersion: 'inv-1' },
    });
    const result = evaluateSampleSufficiency({ sample: s, policy });
    expect(result.gates.marketArchetypeCoverage.status).toBe('PASS');
    expect(result.gates.holdoutValidation.status).toBe('PASS');
    expect(result.status).toBe('SAMPLE_SUFFICIENT');
  });
});
