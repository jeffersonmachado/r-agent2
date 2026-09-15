'use strict';

/**
 * T-B1 — ZERO-FINDINGS-ANALYZED: "pesquisei a fundo e não achei nada novo".
 *
 * O critério ANTIGO (`benchmarkResearchSemantics.evaluateAnalyzedCriterion`)
 * exigia ≥ 1 achado verificado de forma ABSOLUTA (`NO_VERIFIED_FINDING`). Isso
 * tornava impossível o resultado mais importante de uma pesquisa honesta: os
 * três eixos pesquisados, inspeção executada, evidência válida — e ZERO
 * novidade medida. Sem esse estado, todo benchmark maduro ficava eternamente
 * NOT_ANALYZED e a janela de saturação jamais era mensurável.
 *
 * Contrato novo:
 *   - 0 achados É ANALYZED se e somente se a pesquisa é comprovadamente
 *     suficiente: discovery concluído, documentação inspecionada, API
 *     inspecionada OU declarada NOT_APPLICABLE com JUSTIFICATIVA, os 3 eixos
     em RESEARCHED_NO_FINDINGS (ou superior), evidência válida com hash e
 *     locator persistida, zero erros críticos em aberto;
 *   - `NO_VERIFIED_FINDING` deixa de ser bloqueio absoluto: só aparece quando
 *     os eixos NÃO estão pesquisados ou a evidência está ausente/inválida;
 *   - um benchmark com eixos NOT_RESEARCHED mantém `noveltyRate = null`
 *     (ausência de medição) — NUNCA 0.
 */

const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const { mergeSamplePatch } = require('../../../api/services/benchmark/benchmarkSampleRegistry');
const {
  createBenchmarkResearchService,
  RESEARCH_BLOCKERS,
} = require('../../../api/services/benchmark/benchmarkResearchService');
const {
  RESEARCH_AXES,
  AXIS_STATES,
  SEMANTIC_CODES,
  evaluateAnalyzedCriterion,
} = require('../../../api/services/benchmark/benchmarkResearchSemantics');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const POLICY = require('../../../config/benchmark-sufficiency-policy.json');

const TENANT = 'system';
const VERTICAL = 'fitness';

const RESEARCHED_AXES = Object.freeze({
  [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
  [RESEARCH_AXES.JOURNEY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
  [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
});

const VALID_EVIDENCE = Object.freeze([
  Object.freeze({ verified: true, contentHash: 'sha256:doc-analisado-v1', locator: 'document:https://vendor.test/features' }),
]);

describe('T-B1 — critério de ANALYZED com ZERO achados (unitário)', () => {
  test('docs PASS + API NOT_APPLICABLE justificada + 3 eixos RESEARCHED_NO_FINDINGS + evidência válida + 0 erros → SATISFEITO', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'desktop-erp', apiApplicable: false },
      inspections: {
        documentation: true,
        api: false,
        apiApplicable: false,
        apiNotApplicableRationale: 'produto desktop sem API pública documentada pelo fornecedor',
      },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: VALID_EVIDENCE,
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.detail.verifiedFindings).toBe(0);
  });

  test('API aplicável inspecionada + 3 eixos RESEARCHED_NO_FINDINGS + evidência válida → SATISFEITO com 0 achados', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'saas-api' },
      inspections: { documentation: true, api: true },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: VALID_EVIDENCE,
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.missing).not.toContain(SEMANTIC_CODES.NO_VERIFIED_FINDING);
  });

  test('adversarial: API NOT_APPLICABLE SEM justificativa é recusada', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'desktop-erp', apiApplicable: false },
      inspections: { documentation: true, api: false, apiApplicable: false },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: VALID_EVIDENCE,
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain(SEMANTIC_CODES.API_NOT_APPLICABLE_UNJUSTIFIED);
  });

  test('adversarial: 0 achados SEM evidência → NOT_ANALYZED (NO_VERIFIED_FINDING + NO_VALID_EVIDENCE)', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'x' },
      inspections: { documentation: true, api: true },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: [],
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      SEMANTIC_CODES.NO_VALID_EVIDENCE,
      SEMANTIC_CODES.NO_VERIFIED_FINDING,
    ]));
  });

  test('adversarial: 0 achados com evidência SEM hash → NOT_ANALYZED', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'x' },
      inspections: { documentation: true, api: true },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: [{ verified: true, locator: 'document:https://vendor.test/x' }],
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain(SEMANTIC_CODES.EVIDENCE_HASH_MISSING);
    expect(result.missing).toContain(SEMANTIC_CODES.NO_VERIFIED_FINDING);
  });

  test('adversarial: eixos NOT_RESEARCHED com 0 achados → NOT_ANALYZED (nunca "zero novidade")', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'x' },
      inspections: { documentation: true, api: true },
      axes: {
        [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.NOT_RESEARCHED,
        [RESEARCH_AXES.JOURNEY]: AXIS_STATES.NOT_RESEARCHED,
        [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.NOT_RESEARCHED,
      },
      findings: [],
      evidence: VALID_EVIDENCE,
      errors: [],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      SEMANTIC_CODES.AXIS_CAPABILITY_NOT_RESEARCHED,
      SEMANTIC_CODES.AXIS_JOURNEY_NOT_RESEARCHED,
      SEMANTIC_CODES.AXIS_BUSINESS_RULE_NOT_RESEARCHED,
      SEMANTIC_CODES.NO_VERIFIED_FINDING,
    ]));
  });

  test('adversarial: erro crítico em aberto bloqueia mesmo com 0 achados legítimos', () => {
    const result = evaluateAnalyzedCriterion({
      benchmark: { id: 'x' },
      inspections: { documentation: true, api: true },
      axes: RESEARCHED_AXES,
      findings: [],
      evidence: VALID_EVIDENCE,
      errors: [{ severity: 'ERROR', code: 'RESEARCH_FETCH_FAILED', resolved: false }],
      sourceDiscovery: true,
    });

    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain(SEMANTIC_CODES.RESEARCH_ERROR_UNRESOLVED);
  });
});

// ---------------------------------------------------------------------------
// Integração serviço → patch → engine: zero achados medido é taxa 0; eixo não
// pesquisado é taxa NULA.
// ---------------------------------------------------------------------------

const INSPECTION_SOURCE = Object.freeze({
  url: 'https://docs.mature-vendor.test/features',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
  contentHash: 'sha256:mature-vendor-doc-v1',
});

function buildService() {
  let tick = 0;
  return createBenchmarkResearchService({
    store: createBenchmarkResearchMemoryStore(),
    now: () => `2026-09-15T00:00:0${tick++}.000Z`,
  });
}

async function researchWithoutFindings(service, benchmarkId) {
  for (const [axis, state] of Object.entries(RESEARCHED_AXES)) {
    await service.setAxisState({ tenantId: TENANT, vertical: VERTICAL, benchmarkId, axis, state });
  }
  await service.recordInspections({
    tenantId: TENANT,
    vertical: VERTICAL,
    benchmarkId,
    inspections: {
      documentation: true,
      api: false,
      apiApplicable: false,
      apiNotApplicableRationale: 'fornecedor sem superfície de API pública',
    },
  });
  // T-B2: a fonte buscada + inspecionada persiste proveniência MESMO sem achado.
  await service.recordSourceInspection({
    tenantId: TENANT,
    vertical: VERTICAL,
    benchmarkId,
    source: INSPECTION_SOURCE,
    evidenceRef: `ev-${benchmarkId}-doc`,
    analyzedContentHash: INSPECTION_SOURCE.contentHash,
    documentType: 'text/html',
    provider: 'native',
    axisStatuses: RESEARCHED_AXES,
  });
}

function sampleFixture() {
  return {
    vertical: VERTICAL,
    sampleVersion: 'zero-findings-v1',
    inventoryVersion: 'inv-1',
    canonicalInventoryBaseline: 10,
    canonicalJourneyInventoryBaseline: 5,
    canonicalBusinessRuleInventoryBaseline: 5,
    benchmarks: [
      {
        id: 'mature', name: 'Mature Vendor', role: 'discovery', order: 1, archetype: 'a1',
        independenceGroup: 'g1', sources: [{ url: INSPECTION_SOURCE.url, tier: 5 }], novelty: {},
      },
      {
        id: 'untouched', name: 'Untouched Vendor', role: 'discovery', order: 2, archetype: 'a1',
        independenceGroup: 'g2', sources: [{ url: 'https://untouched.test/', tier: 5 }], novelty: {},
      },
    ],
  };
}

describe('T-B1 — benchmark com 0 achados e pesquisa suficiente É ANALYZED', () => {
  test('markAnalyzed aceita, patch declara novidade VAZIA e o engine mede noveltyRate = 0', async () => {
    const service = buildService();
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'zero-findings-research-v1',
      benchmarkIds: ['mature', 'untouched'],
      holdoutBenchmarkId: null,
    });

    await researchWithoutFindings(service, 'mature');
    const analyzed = await service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      marketArchetypeMapping: { archetype: 'independent-gym', rationale: 'pesquisa completa sem novidade' },
    });

    expect(analyzed.analyzedAt).toBeTruthy();
    expect(analyzed.findingsInventory).toEqual([]);

    const patch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: VERTICAL,
      inventoryVersion: 'inv-1',
    });
    const mature = patch.benchmarks.find((benchmark) => benchmark.id === 'mature');
    expect(mature.analyzedAt).toBeTruthy();
    expect(mature.novelty.newCapabilities).toEqual([]);
    expect(mature.novelty.newJourneys).toEqual([]);
    expect(mature.novelty.newBusinessRules).toEqual([]);

    const { sample: merged } = mergeSamplePatch(sampleFixture(), patch);
    const curves = engine.evaluateSaturation({ sample: merged, policy: POLICY });

    // Zero novidade MEDIDA: taxa 0, estado MEASURED — nunca NOT_ANALYZED.
    const maturePoint = curves.curves.capabilities.points.find((point) => point.benchmarkId === 'mature');
    expect(maturePoint.rateState).toBe(engine.RATE_STATES.MEASURED);
    expect(maturePoint.noveltyRate).toBe(0);

    // Benchmark NÃO pesquisado: taxa NULA (ausência de medição), nunca 0.
    const untouchedPoint = curves.curves.capabilities.points.find((point) => point.benchmarkId === 'untouched');
    expect(untouchedPoint.rateState).toBe(engine.RATE_STATES.NOT_ANALYZED);
    expect(untouchedPoint.noveltyRate).toBeNull();
  });

  test('0 achados SEM evidência de inspeção persistida continua RECUSADO', async () => {
    const service = buildService();
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'zero-findings-no-evidence-v1',
      benchmarkIds: ['mature', 'untouched'],
      holdoutBenchmarkId: null,
    });

    for (const [axis, state] of Object.entries(RESEARCHED_AXES)) {
      await service.setAxisState({ tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'mature', axis, state });
    }
    await service.recordInspections({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      inspections: { documentation: true, api: true },
    });

    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE));

    const patch = await service.buildSamplePatch({ tenantId: TENANT, vertical: VERTICAL });
    expect(patch.benchmarks.find((benchmark) => benchmark.id === 'mature').analyzedAt).toBeNull();
  });

  test('NOT_RESEARCHED declarado como "zero novidade" é REJEITADO no merge do sample', async () => {
    const patch = {
      vertical: VERTICAL,
      researchVersion: 'zero-findings-research-v1',
      inventoryVersion: 'inv-1',
      evidence: [],
      benchmarks: [{
        id: 'mature',
        analyzedAt: '2026-09-15T00:00:00.000Z',
        researchVersion: 'zero-findings-research-v1',
        findingsInventory: [],
        marketArchetypeMapping: { archetype: 'independent-gym' },
        axisCompleteness: [
          { axis: RESEARCH_AXES.CAPABILITY, state: AXIS_STATES.NOT_RESEARCHED, researched: false },
          { axis: RESEARCH_AXES.JOURNEY, state: AXIS_STATES.NOT_RESEARCHED, researched: false },
          { axis: RESEARCH_AXES.BUSINESS_RULE, state: AXIS_STATES.NOT_RESEARCHED, researched: false },
        ],
        sources: [{ id: 's1', url: INSPECTION_SOURCE.url, tier: 5, verified: true, httpStatus: 200 }],
        novelty: {},
      }],
    };

    expect(() => mergeSamplePatch(sampleFixture(), patch))
      .toThrow(/sample_patch_findings_inventory_invalid/);
  });
});
