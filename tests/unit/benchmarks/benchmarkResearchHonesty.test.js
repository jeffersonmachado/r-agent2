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
 *   B9  — o holdout é válido: pré-registrado ANTES de qualquer análise, sem
 *         vazamento. Linhagem REAL dos ciclos: ciclo 1 = Zen Planner
 *         (pré-registrado 2026-09-10, analisado DEPOIS da saturação no run r4 —
 *         caminho legal — e INCORPORADO ao discovery set: seus achados contam
 *         no inventário). Ciclo 2 = woliba.io, pré-registrado pelo run de
 *         2026-09-16T09:51 mas INALCANÇÁVEL para o fetcher governado (HTTP 403
 *         total — homepage e blog — verificado em 2026-09-16): abandonado
 *         ANTES de qualquer pesquisa profunda, sem novelty revelada; NUNCA
 *         pode constar como analisado. Ciclo 3 = wellable.co, descoberto
 *         IN_MARKET no run mdr-ad508ef481 (2 sinais de categoria, 6 evidências
 *         hash-bound) e pré-registrado em 2026-09-16T14:56:50Z antes do deep
 *         research — o registro abaixo trava esse pré-registro.
 *   B10 — o gap de arquétipos (financial-billing, student-digital-experience)
 *         foi fechado por PESQUISA REAL (run r5, 2026-09-15): ABC Fitness e
 *         Wellhub entraram como representantes com findings verificados e
 *         evidence refs. O invariante permanece: arquétipos REQUIRED nunca
 *         podem ser rebaixados, removidos ou cobertos por escassez fabricada
 *         para produzir PASS.
 *   B11 — novamente: sem acesso externo não existe "amostra analisada".
 *   B12 — `unanalyzed != zero novelty`: ponto não pesquisado é NOT_ANALYZED com
 *         taxa nula (ausência de medição), nunca 0 (medição que aprovou) —
 *         invariante vale em qualquer ciclo da pesquisa.
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
const HOLDout_ID = 'wellable.co';

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

describe('B9 — holdout wellable.co: pré-registro válido e sem vazamento', () => {
  const holdoutRecord = SAMPLE.holdout;
  const holdoutBenchmark = SAMPLE.benchmarks.find((benchmark) => benchmark.id === HOLDout_ID);

  test('o pré-registro tem todos os campos exigidos e ANTECEDE qualquer análise', () => {
    for (const field of ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion']) {
      expect(holdoutRecord[field]).toBeTruthy();
    }
    expect(holdoutRecord.benchmarkId).toBe(HOLDout_ID);
    // Fato persistido do run mdr-8572d09901 (r17, 2026-09-17): o holdout foi
    // RE-CONFIRMADO pelo ciclo r17 (seleção determinística sobre o pool novo)
    // e o pré-registro renovado neste timestamp — o pin anterior
    // (2026-09-16T14:56:50.852Z, run mdr-ad508ef481) foi substituído JUNTO com
    // esta narrativa. Se o holdout mudar de novo, este pin muda JUNTO com a
    // narrativa do ciclo no cabeçalho (nunca em silêncio).
    expect(holdoutRecord.selectedAsHoldoutAt).toBe('2026-09-17T02:35:06.572Z');
    // Análise (quando houver) TEM que ser posterior ao pré-registro — análise
    // antes do pré-registro seria vazamento.
    if (holdoutRecord.analysedAt || holdoutBenchmark.analyzedAt) {
      expect(holdoutRecord.analysedAt).toBe(holdoutBenchmark.analyzedAt);
      expect(Date.parse(holdoutBenchmark.analyzedAt))
        .toBeGreaterThan(Date.parse(holdoutRecord.selectedAsHoldoutAt));
    }
  });

  test('a linhagem dos ciclos anteriores é honesta: zenplanner INCORPORADO, woliba NUNCA analisado', () => {
    // Zen Planner (holdout do ciclo 1) foi incorporado ao discovery set —
    // incorporação é obrigatória, não opcional: seus achados contam no
    // inventário e a proveniência da incorporação é auditável.
    const zenplanner = SAMPLE.benchmarks.find((benchmark) => benchmark.id === 'zenplanner');
    expect(zenplanner.role).toBe('discovery');
    expect(zenplanner.analyzedAt).toBeTruthy();
    expect(Array.isArray(zenplanner.findingsInventory)).toBe(true);
    expect(zenplanner.incorporation?.marketDiscoveryRunId).toBeTruthy();
    expect(zenplanner.incorporation?.fromRole).toBe('validation');
    // Woliba (pré-registro do ciclo 2) foi abandonado por inalcançabilidade
    // (403 total) ANTES de qualquer pesquisa profunda: não pode constar no
    // sample como benchmark analisado — nem aqui nem nunca.
    const woliba = SAMPLE.benchmarks.find((benchmark) => benchmark.id === 'woliba.io');
    expect(woliba?.analyzedAt).toBeFalsy();
  });

  test('o holdout é um benchmark de VALIDAÇÃO (não participa da descoberta)', () => {
    expect(holdoutBenchmark.role).toBe('validation');
  });

  test('NÃO houve vazamento: o engine não reporta leakage em nenhum estado do ciclo', () => {
    const holdoutGate = engine.evaluateHoldout({ sample: SAMPLE, policy: POLICY });
    const reasons = (holdoutGate.violations || []).map((violation) => violation.reason);

    expect(reasons.some((reason) => String(reason).startsWith('holdout_leakage'))).toBe(false);
    expect(reasons).not.toContain('holdout_preregistration_same_instant_as_analysis');
    // O estado pertence ao ciclo de vida legal; PASS exige análise comprovada
    // (o engine garante: PASS por ausência de trabalho é o bug que B1..B6 travam).
    expect(Object.values(engine.HOLDOUT_STATES)).toContain(holdoutGate.holdoutState);
    if (holdoutGate.status === 'PASS') {
      expect(holdoutGate.holdoutState).toBe(engine.HOLDOUT_STATES.PASS);
      expect(holdoutBenchmark.analyzedAt).toBeTruthy();
      expect(Array.isArray(holdoutBenchmark.findingsInventory)).toBe(true);
      expect(holdoutBenchmark.researchVersion).toBeTruthy();
      expect(holdoutBenchmark.marketArchetypeMapping).toBeTruthy();
    }
  });

  test('a fonte pré-existente do holdout é GENÉRICA (homepage): existência provada, inventário não', () => {
    // Uma homepage prova que o fornecedor existe; ela não expõe (e não prova)
    // inventário de capabilities. Fonte de funcionalidades lida ANTES do
    // pré-registro seria vazamento — e faria o engine falhar acima.
    expect(holdoutBenchmark.sources.length).toBeGreaterThan(0);
    const declared = holdoutBenchmark.sources.filter(
      (source) => !source.retrievedAt || Date.parse(source.retrievedAt) <= Date.parse(holdoutRecord.selectedAsHoldoutAt),
    );
    for (const source of declared) {
      expect(engine.isGenericSource(source)).toBe(true);
    }
  });
});

describe('B10 — o gap de arquétipos: declarado enquanto real, fechado só com evidência', () => {
  test('financial-billing e student-digital-experience seguem REQUIRED; cobertura exige pesquisa comprovada', () => {
    const coverage = engine.evaluateArchetypeCoverage({ sample: SAMPLE });

    for (const id of GAP_ARCHETYPES) {
      const archetype = SAMPLE.archetypes.find((entry) => entry.id === id);
      // Os arquétipos NUNCA podem ser rebaixados/removidos para fingir cobertura.
      expect(archetype.importance).toBe('REQUIRED');
      expect(archetype.status).toBe('ACTIVE');
      // E nunca podem ser cobertos por exceção de escassez (não são escassos).
      expect((SAMPLE.marketScarcityExceptions || []).some((e) => e.archetype === id)).toBe(false);

      if (SAMPLE.benchmarks.some((benchmark) => benchmark.archetype === id)) {
        // 2026-09-15 (run r5): o gap foi fechado por PESQUISA REAL — ABC Fitness
        // e Wellhub, descobertos IN_MARKET com evidência hash-bound e analisados
        // pelo caminho governado. Onde há representante, a representação precisa
        // ser comprovada: análise registrada + mapeamento persistido + fonte
        // oficial verificada + evidence refs que resolvem no inventário.
        for (const benchmark of SAMPLE.benchmarks.filter((b) => b.archetype === id)) {
          expect(Number.isFinite(Date.parse(benchmark.analyzedAt || ''))).toBe(true);
          expect(typeof benchmark.researchVersion).toBe('string');
          expect(Array.isArray(benchmark.findingsInventory)).toBe(true);
          expect(benchmark.findingsInventory.length).toBeGreaterThan(0);
          expect(benchmark.marketArchetypeMapping && benchmark.marketArchetypeMapping.archetype).toBe(id);
          expect((benchmark.sources || []).some((source) => source.verified === true
            && !engine.isGenericSource(source))).toBe(true);
          const supporting = (benchmark.archetypeEvidence && benchmark.archetypeEvidence.supportingFindings) || [];
          expect(supporting.length).toBeGreaterThan(0);
          const inventory = new Set(benchmark.findingsInventory);
          for (const ref of supporting) expect(inventory.has(ref.findingId)).toBe(true);
        }
      }
    }

    // Se o engine diz FAIL, o gap precisa estar nominalmente listado.
    if (coverage.status === 'FAIL') {
      expect(coverage.missingArchetypes.length).toBeGreaterThan(0);
    }
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

  test('nenhum ponto sem evidência completa é MEASURED — em qualquer ciclo da pesquisa', () => {
    // 2026-09-15: os 8 benchmarks foram analisados de verdade (runs r3/r4).
    // O invariante não é "nada analisado" — é: ponto SEM evidência de análise
    // nunca entra na curva como medido, e eixo com janela incompleta nunca PASSa.
    for (const gate of ['capabilitySaturation', 'journeySaturation', 'businessRuleSaturation']) {
      expect(['PASS', 'FAIL', 'NOT_MEASURABLE']).toContain(evaluation.gates[gate].status);
    }
    for (const dimension of ['capabilities', 'journeys', 'businessRules']) {
      const curve = evaluation.inventoryCurves[dimension];
      expect(curve.points.length).toBeGreaterThan(0);
      for (const point of curve.points) {
        if (point.analysisGaps.length > 0) {
          expect(point.rateState).toBe(engine.RATE_STATES.NOT_ANALYZED);
          expect(point.noveltyRate).toBeNull();
        }
      }
    }
  });

  test('unanalyzed != zero novelty: taxa NULA (ausência de medição) para ponto não pesquisado', () => {
    for (const dimension of ['capabilities', 'journeys', 'businessRules']) {
      const curve = evaluation.inventoryCurves[dimension];
      const unanalyzed = curve.points.filter((point) => point.analysisGaps.length > 0);
      for (const point of unanalyzed) {
        expect(point.rateState).toBe(engine.RATE_STATES.NOT_ANALYZED);
        expect(point.noveltyRate).toBeNull();
      }
      // E os analisados são medidos com denominador declarado — nunca taxa inventada.
      const measured = curve.points.filter((point) => point.rateState === engine.RATE_STATES.MEASURED);
      for (const point of measured) {
        expect(point.previousInventorySize).toBeGreaterThan(0);
        expect(typeof point.noveltyRate).toBe('number');
      }
    }
  });

  test('o gate de análise espelha exatamente os benchmarks com analyzedAt registrado', () => {
    const analyzed = SAMPLE.benchmarks.filter((benchmark) => benchmark.analyzedAt);
    expect(evaluation.gates.analysisEvidence.analysedBenchmarks).toBe(analyzed.length);
    expect(evaluation.gates.analysisEvidence.totalBenchmarks).toBe(SAMPLE.benchmarks.length);
    expect(Object.values(engine.HOLDOUT_STATES)).toContain(evaluation.gates.holdoutValidation.holdoutState);
  });
});
