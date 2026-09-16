'use strict';

/**
 * Novidade INCREMENTAL (loop de absorção 2026-09-16).
 *
 * A curva de saturação do engine mede "o que cada benchmark ACRESCENTA ao
 * conhecimento acumulado". Dois gaps tornavam a medida desonesta:
 *
 *   1. Candidato estruturado SEM equivalência declarada recebia
 *      `normalizedId: null` — e a missão é explícita: novelty contada precisa
 *      de normalizedId (ou estado UNRESOLVED). A identidade estável deriva do
 *      FORM semântico (verbo + objeto de negócio), nunca do nome bruto.
 *
 *   2. `buildSamplePatch` computava novelty de cada benchmark SÓ contra o
 *      inventário canônico: o mesmo item descoberto por dois benchmarks
 *      contava como "novo" duas vezes, inflando a taxa de novidade dos
 *      benchmarks tardios. A novelty passa a ser incremental — contra o
 *      canônico + o acumulado dos benchmarks anteriores NA ORDEM DO
 *      DISCOVERY + o que o sample versionado já conhecia (ciclo N+1).
 */

const { runNormalizationPipeline } = require('../../../api/services/benchmark/semantic/normalizationPipeline');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const TENANT = 'system';
const VERTICAL = 'fitness';
const NOW = '2026-09-16T12:00:00.000Z';

describe('normalizationPipeline — normalizedId estável mesmo sem equivalência declarada', () => {
  test('candidato estruturado sem equivalência declarada recebe normalizedId derivado do form', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'Members can freeze an active membership for up to 30 days', locator: 'section:Policies' },
      ],
      contentHash: 'sha256:doc',
      source: { url: 'https://example.com/', tier: 5 },
      benchmark: { id: 'example', name: 'Example', aliases: [] },
    });

    expect(pipeline.candidates).toHaveLength(1);
    const candidate = pipeline.candidates[0];
    expect(candidate.semanticStatus).toBe('NORMALIZED');
    expect(candidate.form).toBeTruthy();
    // Sem equivalência declarada para este form: a identidade é o próprio form
    // (estável entre benchmarks), nunca null, nunca o nome bruto.
    expect(candidate.normalizedId).toBe(candidate.form);
    expect(candidate.canonicalId).toBeNull(); // não mapeado ⇒ novidade, não confirmação
  });

  test('equivalência declarada continua prevalecendo sobre o form', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'Controle de Acesso', locator: 'section:Catraca' },
      ],
      contentHash: 'sha256:doc',
      source: { url: 'https://example.com/', tier: 5 },
      benchmark: { id: 'example', name: 'Example', aliases: [] },
    });
    expect(pipeline.candidates).toHaveLength(1);
    expect(pipeline.candidates[0].normalizedId).toBe('fitness.access.turnstile');
  });
});

describe('buildSamplePatch — novelty incremental contra o acumulado', () => {
  async function buildRun({ findingsByBenchmark }) {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: () => NOW });
    const benchmarkIds = Object.keys(findingsByBenchmark);
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'incremental-novelty-v1',
      benchmarkIds,
    });
    for (const [benchmarkId, findings] of Object.entries(findingsByBenchmark)) {
      for (const finding of findings) {
        await service.recordFinding({
          tenantId: TENANT,
          vertical: VERTICAL,
          benchmarkId,
          kind: finding.kind || 'capability',
          externalName: finding.externalName,
          normalizedId: finding.normalizedId || null,
          source: {
            url: `https://example.com/${benchmarkId}/`, tier: 5, specificity: 'official',
            verified: true, httpStatus: 200, contentHash: 'sha256:doc',
          },
          evidenceRef: `ev-${benchmarkId}`,
          locator: 'section:Features',
          metadata: { semanticStatus: 'NORMALIZED' },
        });
      }
    }
    return service;
  }

  test('o mesmo normalizedId descoberto por dois benchmarks conta como novo UMA vez (ordem do discovery)', async () => {
    const service = await buildRun({
      findingsByBenchmark: {
        alpha: [{ externalName: 'Online booking', normalizedId: 'booking.manage' }],
        beta: [
          { externalName: 'Book classes online', normalizedId: 'booking.manage' },
          { externalName: 'Recurring billing', normalizedId: 'billing.recurring' },
        ],
      },
    });

    const patch = await service.buildSamplePatch({ tenantId: TENANT, vertical: VERTICAL });
    const alpha = patch.benchmarks.find((b) => b.id === 'alpha');
    const beta = patch.benchmarks.find((b) => b.id === 'beta');

    expect(alpha.novelty.newCapabilities.map((i) => i.normalizedId)).toEqual(['booking.manage']);
    // beta redescobre booking.manage (já conhecido) e acrescenta billing.recurring.
    expect(beta.novelty.newCapabilities.map((i) => i.normalizedId)).toEqual(['billing.recurring']);
  });

  test('ciclo N+1: item já presente no sample anterior (benchmark fora do run) não é novidade de novo', async () => {
    const service = await buildRun({
      findingsByBenchmark: {
        newone: [{ externalName: 'Online booking', normalizedId: 'booking.manage' }],
      },
    });

    const priorSample = {
      vertical: VERTICAL,
      benchmarks: [
        {
          id: 'oldone',
          novelty: { newCapabilities: [{ id: 'x1', name: 'Booking antigo', normalizedId: 'booking.manage' }] },
        },
        // Benchmark coberto pelo run: sua novelty ANTIGA é substituída, não
        // pode semear o acumulado (senão o item nunca seria re-medido).
        {
          id: 'newone',
          novelty: { newCapabilities: [{ id: 'x2', name: 'Stale', normalizedId: 'stale.item' }] },
        },
      ],
    };

    const patch = await service.buildSamplePatch({ tenantId: TENANT, vertical: VERTICAL, priorSample });
    const newone = patch.benchmarks.find((b) => b.id === 'newone');
    expect(newone.novelty.newCapabilities).toEqual([]);
  });
});
