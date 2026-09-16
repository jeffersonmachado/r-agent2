'use strict';

/**
 * FITNESS-ABS-13 (2026-09-16) — FRESHNESS derivada da análise no sample-patch.
 *
 * Gap confirmado pelo run real do ciclo 3: `vantagefit.io` foi analisado pelo
 * deep research e o patch gravou `analyzedAt`, mas NENHUM bloco `freshness` —
 * o gate de frescor do engine (`evaluateFreshness`) lê
 * `benchmark.freshness.researchedAt` e marcou o benchmark recém-analisado
 * como UNKNOWN → FAIL. Um benchmark analisado HOJE não pode ser "frescor
 * desconhecido": `researchedAt` é o FATO da análise (`analyzedAt`, persistido
 * no subject) e `nextReviewAt` é agenda derivada da POLÍTICA versionada
 * (`maximumBenchmarkReviewAgeDays`) — nunca constante de código.
 *
 * Benchmark NÃO analisado (holdout pré-registrado) NÃO ganha freshness:
 * declarar pesquisa que não aconteceu é evidência fabricada.
 */

const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
const { mergeSamplePatch } = require('../../../api/services/benchmark/benchmarkSampleRegistry');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const TENANT = 'system';
const VERTICAL = 'fitness';
const NOW = '2026-09-16T17:00:00.000Z';
const POLICY = require('../../../config/benchmark-sufficiency-policy.json');

function expectedNextReview(researchedAt) {
  const days = Number(POLICY.maximumBenchmarkReviewAgeDays) || 365;
  return new Date(Date.parse(`${researchedAt}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

describe('FITNESS-ABS-13 — freshness derivada da análise (patch + merge)', () => {
  async function buildAnalyzedRun() {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: () => NOW });
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-freshness-v1',
      benchmarkIds: ['vantagefit.io'],
      holdoutBenchmarkId: 'wellable.co',
    });
    const contentHash = 'sha256:freshness-content';
    const source = {
      url: 'https://vantagefit.io/features/',
      tier: 5,
      specificity: 'SPECIFIC',
      verified: true,
      httpStatus: 200,
      contentHash,
    };
    // Espelha o fluxo do supervisor: inspeção por fonte (hash-bound) → achado
    // verificado → estados de eixo → inspeções agregadas → markAnalyzed.
    await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'vantagefit.io',
      source,
      evidenceRef: 'ev-freshness-1',
      analyzedContentHash: contentHash,
      documentType: 'text/html',
      documentationStatus: 'INSPECTED',
      apiStatus: 'INSPECTED',
    });
    await service.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'vantagefit.io',
      kind: 'capability',
      externalName: 'Gestão de planos corporativos',
      canonicalId: null,
      source,
      evidenceRef: 'ev-freshness-1',
      locator: 'section:Planos',
      analyzedContentHash: contentHash,
      benchmark: { id: 'vantagefit.io', name: 'Vantage Fit', aliases: [] },
    });
    for (const [axis, state] of [
      ['CAPABILITY_AXIS', 'RESEARCHED_WITH_FINDINGS'],
      ['JOURNEY_AXIS', 'RESEARCHED_NO_FINDINGS'],
      ['BUSINESS_RULE_AXIS', 'RESEARCHED_NO_FINDINGS'],
    ]) {
      await service.setAxisState({ tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'vantagefit.io', axis, state });
    }
    await service.recordInspections({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'vantagefit.io',
      inspections: { documentation: true, api: true, apiApplicable: true, executedAt: NOW },
      metadata: { benchmark: { id: 'vantagefit.io', name: 'Vantage Fit', aliases: [] } },
    });
    await service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'vantagefit.io',
      marketArchetypeMapping: { archetype: 'personal-wellness', rationale: 'declarado no sample' },
    });
    return { store, service };
  }

  test('buildSamplePatch emite freshness do FATO (analyzedAt) + agenda da POLÍTICA', async () => {
    const { service } = await buildAnalyzedRun();
    const patch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: VERTICAL,
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    const patched = patch.benchmarks.find((benchmark) => benchmark.id === 'vantagefit.io');
    expect(patched.analyzedAt).toBe(NOW);
    expect(patched.freshness).toEqual({
      researchedAt: '2026-09-16',
      nextReviewAt: expectedNextReview('2026-09-16'),
      status: 'FRESH',
    });
  });

  test('mergeSamplePatch grava freshness no benchmark analisado; holdout não analisado NÃO ganha', async () => {
    const { service } = await buildAnalyzedRun();
    const patch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: VERTICAL,
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    const sample = {
      vertical: VERTICAL,
      benchmarks: [
        { id: 'vantagefit.io', name: 'Vantage Fit', role: 'discovery', sources: [{ url: 'https://vantagefit.io/features/', tier: 5 }], novelty: {} },
        { id: 'wellable.co', name: 'Wellable', role: 'validation', sources: [{ url: 'https://www.wellable.co/', tier: 5 }], novelty: {} },
      ],
    };
    const { sample: merged, applied } = mergeSamplePatch(sample, patch);
    expect(applied).toEqual(['vantagefit.io']);
    const vantage = merged.benchmarks.find((benchmark) => benchmark.id === 'vantagefit.io');
    expect(vantage.freshness).toEqual({
      researchedAt: '2026-09-16',
      nextReviewAt: expectedNextReview('2026-09-16'),
      status: 'FRESH',
    });
    const holdout = merged.benchmarks.find((benchmark) => benchmark.id === 'wellable.co');
    expect(holdout.freshness ?? null).toBeNull();
    expect(holdout.analyzedAt ?? null).toBeNull();
  });
});
