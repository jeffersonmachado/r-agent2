'use strict';

/**
 * Regressão do modelo de fases de benchmark.
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *  1. A fase é MEDIDA. Fase declarada seria uma afirmação sobre o que existe —
 *     e é exatamente isso que o modelo tem de apurar.
 *  2. BLOCKER e VIOLATION são coisas diferentes. Tratar pendência de trabalho
 *     como falha de motor foi o defeito medido: 5 verticais que nem começaram
 *     faziam o gate de suficiência FALHAR.
 *  3. Holdout que responde ZERO não fica preso. Um modelo que exige achados
 *     para avançar premia o holdout que encontra coisas e pune o que mede
 *     especificidade — invertendo o propósito do instrumento.
 *  4. O holdout é lido de `holdout.benchmarkId` (o campo real).
 */

const {
  PHASES,
  PHASE_ORDER,
  CERTIFICATION_CLAIM,
  isAtLeast,
  resolveHoldoutId,
  resolveResearchPhase,
  resolvePhase,
  evaluatePhaseRequirements,
} = require('../../../api/services/benchmark/benchmarkPhaseModel');

const RUN = (overrides = {}) => ({ id: 'r1', saturated: false, hasDiscoverySet: true, ...overrides });

describe('resolveHoldoutId — campo canônico é benchmarkId', () => {
  it('lê benchmarkId (o campo REAL do sample)', () => {
    expect(resolveHoldoutId({ holdout: { benchmarkId: 'wellable.co' } })).toBe('wellable.co');
  });

  it('tolera id como fallback, mas sem inventar', () => {
    expect(resolveHoldoutId({ holdout: { id: 'x.co' } })).toBe('x.co');
    expect(resolveHoldoutId({ holdout: {} })).toBeNull();
    expect(resolveHoldoutId({})).toBeNull();
    expect(resolveHoldoutId(null)).toBeNull();
  });
});

describe('resolveResearchPhase — derivada de evidência', () => {
  it('sem runs é NOT_STARTED', () => {
    expect(resolveResearchPhase({ runs: [] }).phase).toBe(PHASES.NOT_STARTED);
  });

  it('run sem discovery set é MARKET_DISCOVERY', () => {
    const phase = resolveResearchPhase({ runs: [RUN({ hasDiscoverySet: false })] }).phase;
    expect(phase).toBe(PHASES.MARKET_DISCOVERY);
  });

  it('discovery set pronto sem achados é DISCOVERY_SET_READY', () => {
    const phase = resolveResearchPhase({ runs: [RUN()], counts: { findings: 0 } }).phase;
    expect(phase).toBe(PHASES.DISCOVERY_SET_READY);
  });

  it('com achados e sem saturação é RESEARCHING', () => {
    const phase = resolveResearchPhase({ runs: [RUN()], counts: { findings: 10 } }).phase;
    expect(phase).toBe(PHASES.RESEARCHING);
  });

  it('saturado sem holdout respondido é APPARENT_SATURATION', () => {
    const phase = resolveResearchPhase({
      runs: [RUN({ saturated: true })],
      counts: { findings: 10 },
      holdoutId: 'wellable.co',
    }).phase;
    expect(phase).toBe(PHASES.APPARENT_SATURATION);
  });

  it('holdout inspecionado com ZERO achados avança para HOLDOUT', () => {
    // Medido em 2026-09-19: wellable.co tem 5 inspeções RESEARCHED_NO_FINDINGS
    // e 0 achados. Exigir achados aqui travaria o instrumento para sempre.
    const phase = resolveResearchPhase({
      runs: [RUN({ saturated: true })],
      counts: { findings: 10 },
      holdoutId: 'wellable.co',
      holdoutAnalyzed: false,
      holdoutInspected: true,
    }).phase;
    expect(phase).toBe(PHASES.HOLDOUT);
  });

  it('holdout com achados também avança', () => {
    const phase = resolveResearchPhase({
      runs: [RUN({ saturated: true })],
      counts: { findings: 10 },
      holdoutId: 'x.co',
      holdoutAnalyzed: true,
    }).phase;
    expect(phase).toBe(PHASES.HOLDOUT);
  });

  it('saturação é do run MAIS RECENTE, não de qualquer run', () => {
    const phase = resolveResearchPhase({
      runs: [RUN({ id: 'r1', saturated: true }), RUN({ id: 'r2', saturated: false })],
      counts: { findings: 10 },
    }).phase;
    expect(phase).toBe(PHASES.RESEARCHING);
  });
});

describe('resolvePhase — declaração não é fase', () => {
  const runs = [RUN({ saturated: true })];
  const counts = { findings: 10 };
  const holdoutInspected = true;

  it('sem claim, a fase para no ciclo de pesquisa (nunca SAMPLE_SUFFICIENT)', () => {
    const { phase } = resolvePhase({ sample: { holdout: { benchmarkId: 'x.co' } }, runs, counts, holdoutInspected });
    expect(phase).toBe(PHASES.HOLDOUT);
  });

  it('claim sem versão semântica atual fica em SAMPLE_SUFFICIENT, não CERTIFIED', () => {
    const { phase } = resolvePhase({
      sample: { claim: CERTIFICATION_CLAIM, holdout: { benchmarkId: 'x.co' }, semanticPipelineVersion: 'sem-v1:antiga' },
      runs, counts, holdoutInspected, currentSemanticVersion: 'sem-v1:atual',
    });
    expect(phase).toBe(PHASES.SAMPLE_SUFFICIENT);
  });

  it('claim + versão atual chega a CERTIFIED', () => {
    const { phase } = resolvePhase({
      sample: { claim: CERTIFICATION_CLAIM, holdout: { benchmarkId: 'x.co' }, semanticPipelineVersion: 'sem-v1:atual' },
      runs, counts, holdoutInspected, currentSemanticVersion: 'sem-v1:atual',
    });
    expect(phase).toBe(PHASES.CERTIFIED);
  });
});

describe('evaluatePhaseRequirements — BLOCKER não é VIOLATION', () => {
  it('pesquisa NÃO iniciada sem holdout é BLOCKER (pendência, não falha)', () => {
    const { blockers, violations } = evaluatePhaseRequirements({
      phase: PHASES.NOT_STARTED,
      holdoutPreregistered: false,
      sample: { vertical: 'clinic' },
    });
    expect(blockers.map((b) => b.code)).toEqual(['holdout_preregistration_required_before_research']);
    expect(violations).toEqual([]);
  });

  it('pesquisa JÁ iniciada sem holdout é VIOLATION (contaminação irreversível)', () => {
    const { blockers, violations } = evaluatePhaseRequirements({
      phase: PHASES.RESEARCHING,
      holdoutPreregistered: false,
      sample: { vertical: 'beauty' },
    });
    expect(violations.map((v) => v.code)).toEqual(['holdout_not_preregistered']);
    expect(blockers).toEqual([]);
  });

  it('holdout pré-registrado não gera nada', () => {
    for (const phase of PHASE_ORDER) {
      const { blockers, violations } = evaluatePhaseRequirements({
        phase,
        holdoutPreregistered: true,
        sample: { vertical: 'fitness' },
      });
      expect(blockers).toEqual([]);
      expect(violations).toEqual([]);
    }
  });

  it('vertical sem amostra não gera BLOCKER (não há o que pré-registrar)', () => {
    const { blockers, violations } = evaluatePhaseRequirements({
      phase: PHASES.NOT_STARTED,
      holdoutPreregistered: false,
      sample: null,
    });
    expect(blockers).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('a partir de RESEARCHING conta como pesquisa iniciada', () => {
    expect(evaluatePhaseRequirements({ phase: PHASES.RESEARCHING, holdoutPreregistered: false }).researchStarted).toBe(true);
    expect(evaluatePhaseRequirements({ phase: PHASES.DISCOVERY_SET_READY, holdoutPreregistered: false }).researchStarted).toBe(false);
  });
});

describe('ordem das fases', () => {
  it('isAtLeast respeita a ordem canônica', () => {
    expect(isAtLeast(PHASES.HOLDOUT, PHASES.RESEARCHING)).toBe(true);
    expect(isAtLeast(PHASES.NOT_STARTED, PHASES.RESEARCHING)).toBe(false);
    expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe(PHASES.CERTIFIED);
  });
});
