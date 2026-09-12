'use strict';

/**
 * benchmarkSaturationHonesty — RED→GREEN do gap B1..B6.
 *
 * Regra: um benchmark NÃO ANALISADO nunca é um ponto MENSURÁVEL da curva de
 * descoberta. Sem pesquisa não existe "novidade = 0" — existe AUSÊNCIA DE MEDIÇÃO.
 *
 *   unanalyzed  !=  measured zero
 *   window insuficiente de pontos reais  ->  NOT_MEASURABLE (nunca PASS)
 *
 * Estes testes falhavam antes da correção: com baseline de capabilities
 * DECLARADO (12) e todos os benchmarks com `analyzedAt: null`, o eixo
 * capabilities era marcado `rateState: MEASURED` com `noveltyRate: 0` e o gate
 * devolvia `status: PASS` — PASS por AUSÊNCIA DE TRABALHO.
 */

const path = require('path');

const {
  evaluateSampleSufficiency,
  RATE_STATES,
} = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');

const POLICY = require('../../../config/benchmark-sufficiency-policy.json');
const REAL_FITNESS_SAMPLE = require('../../../config/benchmarks/fitness.json');

const DIMENSIONS = ['capabilities', 'journeys', 'businessRules'];
const GATE_KEY = {
  capabilities: 'capabilitySaturation',
  journeys: 'journeySaturation',
  businessRules: 'businessRuleSaturation',
};

/** Benchmark sem pesquisa: arrays vazios e `analyzedAt: null`. */
function unanalyzedBenchmark(index) {
  return {
    id: `bm-unanalyzed-${index}`,
    name: `Unanalyzed ${index}`,
    role: 'discovery',
    order: index,
    archetype: 'independent-gym',
    independenceGroup: `group-${index}`,
    analyzedAt: null,
    previousInventorySize: 12,
    novelty: {
      newCapabilities: [],
      newRequiredCapabilities: [],
      newCriticalCapabilities: [],
      newJourneys: [],
      newRequiredJourneys: [],
      newCriticalJourneys: [],
      newBusinessRules: [],
      newRequiredBusinessRules: [],
      newCriticalBusinessRules: [],
    },
    // Fonte declarada SEM análise: é exatamente o estado que produzia o falso PASS.
    sources: [{ tier: 5, url: `https://example-${index}.test/`, retrievedAt: '2026-09-10', verified: true }],
    dimensions: {
      marketArchetype: 'independent-gym',
      customerSize: 'small',
      geography: 'BR',
      businessModel: 'saas-vertical',
      operationalDepth: 'high',
      integrationMaturity: 'medium',
      physicalOperation: 'partial',
      financialDepth: 'high',
      customerEngagementDepth: 'medium',
    },
  };
}

/** Benchmark realmente pesquisado: evidência de análise completa. */
function analyzedBenchmark(index, novelty = {}) {
  const base = unanalyzedBenchmark(index);
  return {
    ...base,
    analyzedAt: '2026-09-10T12:00:00.000Z',
    analyzedBy: 'research-supervisor',
    researchStatus: 'ANALYZED',
    researchVersion: 'fitness-research-v1',
    findingsInventory: [`finding-${index}-1`],
    sources: [
      { tier: 1, url: `https://official-${index}.test/docs`, retrievedAt: '2026-09-10', verified: true, httpStatus: 200 },
    ],
    novelty: { ...base.novelty, ...novelty },
  };
}

/** Amostra no formato real de `config/benchmarks/fitness.json`. */
function buildSample(benchmarks, overrides = {}) {
  return {
    vertical: 'fitness',
    sampleVersion: 'test-sample-v1',
    inventoryVersion: 'canonical-capabilities-1.0.0',
    canonicalInventoryBaseline: 12,
    benchmarks,
    holdout: {
      benchmarkId: 'holdout-not-analyzed',
      selectedAsHoldoutAt: '2026-09-10T21:00:00.000Z',
      selectionReason: 'holdout de teste',
      selectionEvidence: 'evidência de pré-registro',
      marketArchetype: 'crossfit-box',
      inventoryVersion: 'canonical-capabilities-1.0.0',
    },
    ...overrides,
  };
}

function saturation(result, dimension) {
  return result.gates[GATE_KEY[dimension]];
}

describe('benchmark saturation honesty (B1..B6)', () => {
  describe('B6 — 7 benchmarks nao analisados nunca produzem PASS', () => {
    const sample = buildSample(Array.from({ length: 7 }, (_, i) => unanalyzedBenchmark(i + 1)));
    const result = evaluateSampleSufficiency({ sample, policy: POLICY });

    it.each(DIMENSIONS)('%s saturation = NOT_MEASURABLE', (dimension) => {
      expect(saturation(result, dimension).status).toBe('NOT_MEASURABLE');
    });

    it.each(DIMENSIONS)('%s saturation nunca e PASS', (dimension) => {
      expect(saturation(result, dimension).status).not.toBe('PASS');
    });

    it.each(DIMENSIONS)('%s: nenhum ponto nao analisado e contado como MEASURED', (dimension) => {
      const curve = result.inventoryCurves[dimension];
      const measured = curve.points.filter((p) => p.rateState === RATE_STATES.MEASURED);
      expect(measured).toHaveLength(0);
    });

    it('nao e certificavel e a amostra nao e suficiente', () => {
      expect(result.certifiable).toBe(false);
      expect(result.sampleSufficient).not.toBe(true);
    });

    it('B3 — estado honesto e NOT_RESEARCHED (nunca medido como 0)', () => {
      expect(result.status).toBe('SAMPLE_NOT_RESEARCHED');
      expect(String(result.status)).not.toContain('SATURATED');
    });
  });

  describe('B4 — janela de saturacao nao se completa com benchmark nao pesquisado', () => {
    it('1 analisado + 1 nao analisado na janela => NOT_MEASURABLE', () => {
      const benchmarks = [
        ...Array.from({ length: 4 }, (_, i) => analyzedBenchmark(i + 1)),
        analyzedBenchmark(5),
        unanalyzedBenchmark(6),
      ];
      const result = evaluateSampleSufficiency({ sample: buildSample(benchmarks), policy: POLICY });

      // saturação usa as ULTIMAS 2 observacoes independentes: bm5 (analisado) + bm6 (nao)
      const cap = saturation(result, 'capabilities');
      expect(cap.window).toEqual(['bm-unanalyzed-5', 'bm-unanalyzed-6']);
      expect(cap.status).toBe('NOT_MEASURABLE');
    });

    it('janela inteiramente analisada permanece mensuravel (controle positivo)', () => {
      const benchmarks = [
        ...Array.from({ length: 3 }, (_, i) => analyzedBenchmark(i + 1)),
        analyzedBenchmark(4),
        analyzedBenchmark(5),
      ];
      const result = evaluateSampleSufficiency({ sample: buildSample(benchmarks), policy: POLICY });

      const cap = saturation(result, 'capabilities');
      expect(cap.window).toEqual(['bm-unanalyzed-4', 'bm-unanalyzed-5']);
      expect(cap.status).toBe('PASS');
      expect(cap.rateState).toBe(RATE_STATES.MEASURED);
    });
  });

  describe('B1 — amostra real do repositorio nao pode reportar saturacao PASS', () => {
    const result = evaluateSampleSufficiency({ sample: REAL_FITNESS_SAMPLE, policy: POLICY });

    it('todos os benchmarks reais estao sem analyzer => nenhuma saturacao PASS', () => {
      const withoutAnalysis = (REAL_FITNESS_SAMPLE.benchmarks || []).filter((b) => !b.analyzedAt);
      expect(withoutAnalysis.length).toBeGreaterThan(0);

      for (const dimension of DIMENSIONS) {
        expect(saturation(result, dimension).status).not.toBe('PASS');
      }
    });

    it('capabilities nao pode ser PASS enquanto nao houver pesquisa', () => {
      expect(saturation(result, 'capabilities').status).toBe('NOT_MEASURABLE');
    });

    it('amostra real nao e certificavel', () => {
      expect(result.certifiable).toBe(false);
    });
  });

  describe('B2 — evidencia de analise e o criterio de mensurabilidade', () => {
    it('analyzedAt sem researchVersion/findingsInventory nao torna o ponto mensuravel', () => {
      const partial = {
        ...unanalyzedBenchmark(9),
        analyzedAt: '2026-09-10T12:00:00.000Z',
        // sem researchVersion, sem findingsInventory, e sem sources
        sources: [],
      };
      const benchmarks = [unanalyzedBenchmark(1), unanalyzedBenchmark(2), partial];
      const result = evaluateSampleSufficiency({ sample: buildSample(benchmarks), policy: POLICY });
      const cap = saturation(result, 'capabilities');
      // a janela de saturacao e formada pelas 2 ultimas ordens: bm-2 e bm-9 (parcial)
      expect(cap.window).toEqual(['bm-unanalyzed-2', 'bm-unanalyzed-9']);
      expect(cap.status).toBe('NOT_MEASURABLE');
    });

    it('analyzedAt Valido COM evidencia completa torna o ponto mensuravel', () => {
      const benchmarks = [
        unanalyzedBenchmark(1),
        analyzedBenchmark(8),
        analyzedBenchmark(9),
      ];
      const result = evaluateSampleSufficiency({ sample: buildSample(benchmarks), policy: POLICY });
      const cap = saturation(result, 'capabilities');
      expect(cap.window).toEqual(['bm-unanalyzed-8', 'bm-unanalyzed-9']);
      expect(cap.rateState).toBe(RATE_STATES.MEASURED);
      expect(cap.status).toBe('PASS');
    });
  });
});
