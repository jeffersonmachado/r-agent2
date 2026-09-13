'use strict';

/**
 * §B8/§B9/§B10/§B11/§B12 — HONESTIDADE DO ESTADO DA PESQUISA FITNESS.
 *
 * Este arquivo não "testa funcionalidade": ele trava as afirmações que a
 * plataforma pode fazer sobre a pesquisa de mercado Fitness. Cada teste
 * corresponde a uma frase que seria FALSA se o comportamento regredisse.
 *
 *   B8  — sem provider externo governado, o estado é RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS
 *         e o sample versionado NÃO é tocado (nem um byte).
 *   B9  — o holdout (Zen Planner) é válido: pré-registrado ANTES de qualquer
 *         análise, sem vazamento, e nenhuma capacidade dele foi lida.
 *   B10 — o gap de arquétipos (financial-billing, student-digital-experience)
 *         continua declarado e NÃO pode ser rebaixado para produzir PASS.
 *   B11 — novamente: sem acesso externo não existe "amostra analisada".
 *   B12 — `unanalyzed != zero novelty`: ponto não pesquisado é NOT_ANALYZED com
 *         taxa nula (ausência de medição), nunca 0 (medição que aprovou).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const {
  RESEARCH_RUN_OUTCOMES,
  createBenchmarkResearchSupervisor,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SAMPLE_PATH = path.join(REPO_ROOT, 'config', 'benchmarks', 'fitness.json');
const POLICY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'));
const SAMPLE = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const GAP_ARCHETYPES = ['financial-billing', 'student-digital-experience'];
const HOLDout_ID = 'zenplanner';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('B8/B11 — sem acesso externo o estado é BLOQUEIO, não resultado', () => {
  test('nenhum provider governado de pesquisa está disponível neste runtime', () => {
    const registry = createToolRegistry({ logger: silent });
    const supervisor = createBenchmarkResearchSupervisor({
      store: createBenchmarkResearchMemoryStore(),
      registry,
      providers: {},
      tenantId: 'system',
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      logger: silent,
    });
    const availability = supervisor.providerAvailability();

    expect(availability.externalAccess).toBe(false);
    expect(availability.missing).toEqual(
      expect.arrayContaining(['research.search', 'research.fetch', 'research.captureEvidence']),
    );
  });

  test('executar contra o sample REAL sem provider bloqueia e NÃO altera o arquivo', async () => {
    const before = sha256File(SAMPLE_PATH);

    const registry = createToolRegistry({ logger: silent });
    const store = createBenchmarkResearchMemoryStore();
    const supervisor = createBenchmarkResearchSupervisor({
      store,
      registry,
      providers: {},
      tenantId: 'system',
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      logger: silent,
    });

    await supervisor.service.openDiscoverySet({
      tenantId: 'system',
      vertical: 'fitness',
      researchVersion: 'fitness-research-honesty-v1',
      benchmarkIds: SAMPLE.benchmarks.map((benchmark) => benchmark.id),
      holdoutBenchmarkId: SAMPLE.holdout.benchmarkId,
    });

    const result = await supervisor.research({ vertical: 'fitness', sample: SAMPLE });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.BLOCKED_NO_EXTERNAL_ACCESS);
    expect(result.analyzed).toEqual([]);
    expect(result.results.every((entry) => entry.attempts.every(
      (attempt) => attempt.status === 'RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS',
    ))).toBe(true);

    // Nada foi analisado e o arquivo versionado é IDÊNTICO.
    const summary = await supervisor.summarize({ vertical: 'fitness' });
    expect(summary.analysedBenchmarks).toBe(0);
    expect(sha256File(SAMPLE_PATH)).toBe(before);
  });
});

describe('B9 — holdout Zen Planner: pré-registro válido e sem vazamento', () => {
  const holdoutRecord = SAMPLE.holdout;
  const holdoutBenchmark = SAMPLE.benchmarks.find((benchmark) => benchmark.id === HOLDout_ID);

  test('o pré-registro tem todos os campos exigidos, ANTES de qualquer análise', () => {
    for (const field of ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion']) {
      expect(holdoutRecord[field]).toBeTruthy();
    }
    expect(holdoutRecord.benchmarkId).toBe(HOLDout_ID);
    expect(holdoutRecord.selectedAsHoldoutAt).toBe('2026-09-10T21:00:00.000Z');
    expect(holdoutRecord.analysedAt).toBeNull();
    expect(holdoutBenchmark.analyzedAt).toBeNull();
  });

  test('o holdout é um benchmark de VALIDAÇÃO (não participa da descoberta)', () => {
    expect(holdoutBenchmark.role).toBe('validation');
  });

  test('NÃO houve vazamento: o engine não reporta leakage e o estado é NOT_ANALYZED', () => {
    const holdoutGate = engine.evaluateHoldout({ sample: SAMPLE, policy: POLICY });
    const reasons = (holdoutGate.violations || []).map((violation) => violation.reason);

    expect(reasons.some((reason) => String(reason).startsWith('holdout_leakage'))).toBe(false);
    expect(reasons).not.toContain('holdout_preregistration_same_instant_as_analysis');
    expect(holdoutGate.holdoutState).toBe(engine.HOLDOUT_STATES.NOT_ANALYZED);
    expect(holdoutGate.status).not.toBe('PASS');
  });

  test('nenhuma capacidade do holdout foi lida: só há fonte GENÉRICA (homepage) declarada', () => {
    // Uma homepage prova que o fornecedor existe; ela não expõe (e não prova)
    // inventário de capabilities. Se houvesse página de funcionalidades lida
    // ANTES do pré-registro, aí sim haveria vazamento — e o teste falharia.
    expect(holdoutBenchmark.sources.length).toBeGreaterThan(0);
    for (const source of holdoutBenchmark.sources) {
      expect(engine.isGenericSource(source)).toBe(true);
    }
    // E nenhum content/evidência de análise foi declarado para ele.
    expect(holdoutBenchmark.findingsInventory).toBeUndefined();
    expect(holdoutBenchmark.researchVersion).toBeUndefined();
  });
});

describe('B10 — o gap de arquétipos permanece declarado, não escondido', () => {
  test('financial-billing e student-digital-experience seguem REQUIRED e SEM benchmark', () => {
    const coverage = engine.evaluateArchetypeCoverage({ sample: SAMPLE });
    expect(coverage.status).toBe('FAIL');
    expect(coverage.missingArchetypes).toEqual(expect.arrayContaining(GAP_ARCHETYPES));

    for (const id of GAP_ARCHETYPES) {
      const archetype = SAMPLE.archetypes.find((entry) => entry.id === id);
      expect(archetype.importance).toBe('REQUIRED');
      expect(archetype.status).toBe('ACTIVE');
      expect(SAMPLE.benchmarks.some((benchmark) => benchmark.archetype === id)).toBe(false);
    }
    expect(SAMPLE.marketScarcityExceptions).toEqual([]);
  });
});

describe('B11/B12 — saturação não pode ser fabricada pela ausência de pesquisa', () => {
  const evaluation = engine.evaluateSampleSufficiency({ sample: SAMPLE, policy: POLICY });

  test('a amostra real não é suficiente, não é certificável e não declara cobertura', () => {
    expect(evaluation.certifiable).toBe(false);
    expect(evaluation.sampleSufficient).not.toBe(true);
    expect(String(evaluation.status)).not.toBe('SAMPLE_SUFFICIENT');
    expect(evaluation.coverageStatement).toBeTruthy();
  });

  test('nenhum benchmark real está analisado — logo nenhum eixo pode ser PASS', () => {
    expect(SAMPLE.benchmarks.every((benchmark) => benchmark.analyzedAt === null)).toBe(true);
    for (const gate of ['capabilitySaturation', 'journeySaturation', 'businessRuleSaturation']) {
      expect(evaluation.gates[gate].status).toBe('NOT_MEASURABLE');
    }
  });

  test('unanalyzed != zero novelty: taxa é NULA (ausência de medição), nunca 0', () => {
    for (const dimension of ['capabilities', 'journeys', 'businessRules']) {
      const curve = evaluation.inventoryCurves[dimension];
      expect(curve.points.length).toBeGreaterThan(0);
      for (const point of curve.points) {
        expect(point.rateState).toBe(engine.RATE_STATES.NOT_ANALYZED);
        expect(point.noveltyRate).toBeNull();
        expect(point.analysisGaps.length).toBeGreaterThan(0);
      }
    }
  });

  test('a amostra real não pode ser promovida sem pesquisa: gate de análise reprova', () => {
    expect(evaluation.gates.analysisEvidence.status).toBe('FAIL');
    expect(evaluation.gates.analysisEvidence.analysedBenchmarks).toBe(0);
    expect(evaluation.gates.holdoutValidation.holdoutState).toBe(engine.HOLDOUT_STATES.NOT_ANALYZED);
  });
});
