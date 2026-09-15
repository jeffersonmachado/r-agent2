'use strict';

/**
 * T-B2 — BenchmarkSourceInspection: proveniência de inspeção POR FONTE.
 *
 * GAP (auditoria 2026-09-15): evidência só era gravada dentro de
 * `recordFinding` — uma fonte buscada + inspecionada com ZERO achados não
 * deixava NENHUMA proveniência (contentHash, retrievedAt, inspectedAt,
 * documentType, estado por eixo). Sem essa linha, "pesquisei e não achei nada"
 * era indistinguível de "não pesquisei" depois do restart.
 *
 * Contrato:
 *   - TODA fonte buscada + inspecionada persiste uma linha de inspeção, MESMO
 *     com zero achados;
 *   - hash binding: hash do fetch === hash da inspeção === hash da evidência;
 *     divergência é FALHA (`INSPECTION_HASH_MISMATCH`/`EVIDENCE_HASH_MISMATCH`);
 *   - idempotente por (sourceId, contentHash): re-inspeção do mesmo conteúdo
 *     faz UPSERT, nunca duplica;
 *   - o store é Postgres em produção (`persistence_required` sem Sequelize);
 *     este arquivo exercita a POLÍTICA contra o store em memória de testes.
 */

const {
  createBenchmarkResearchService,
  RESEARCH_BLOCKERS,
} = require('../../../api/services/benchmark/benchmarkResearchService');
const {
  RESEARCH_AXES,
  AXIS_STATES,
  SEMANTIC_CODES,
} = require('../../../api/services/benchmark/benchmarkResearchSemantics');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const TENANT = 'system';
const VERTICAL = 'fitness';

const SOURCE = Object.freeze({
  url: 'https://docs.mature-vendor.test/features',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
  contentHash: 'sha256:mature-doc-v1',
});

const NO_FINDINGS_AXES = Object.freeze({
  [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
  [RESEARCH_AXES.JOURNEY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
  [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
});

function buildService() {
  const store = createBenchmarkResearchMemoryStore();
  const service = createBenchmarkResearchService({
    store,
    now: () => '2026-09-15T00:00:00.000Z',
  });
  return { service, store };
}

async function openRun(service) {
  return service.openDiscoverySet({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion: 'inspection-provenance-v1',
    benchmarkIds: ['mature'],
    holdoutBenchmarkId: null,
  });
}

async function currentRun(store) {
  return store.getRun({ tenantId: TENANT, vertical: VERTICAL });
}

describe('T-B2 — fonte inspecionada SEM achados persiste linha de inspeção', () => {
  test('recordSourceInspection grava a linha com hash, timestamps e estado por eixo', async () => {
    const { service, store } = buildService();
    await openRun(service);

    const inspection = await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: SOURCE.contentHash,
      retrievedAt: '2026-09-15T00:00:00.000Z',
      inspectedAt: '2026-09-15T00:00:01.000Z',
      documentType: 'text/html',
      provider: 'native',
      axisStatuses: NO_FINDINGS_AXES,
    });

    expect(inspection.id).toMatch(/^brsi-/);
    expect(inspection.contentHash).toBe(SOURCE.contentHash);
    expect(inspection.documentationStatus).toBe('INSPECTED');
    expect(inspection.apiStatus).toBe('INSPECTED');

    const run = await currentRun(store);
    const rows = await store.listSourceInspections({ tenantId: TENANT, runId: run.id, benchmarkId: 'mature' });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe(SOURCE.url);
    expect(rows[0].content_hash).toBe(SOURCE.contentHash);
    expect(rows[0].document_type).toBe('text/html');
    expect(rows[0].provider).toBe('native');
    expect(rows[0].capability_axis_status).toBe(AXIS_STATES.RESEARCHED_NO_FINDINGS);
    expect(rows[0].journey_axis_status).toBe(AXIS_STATES.RESEARCHED_NO_FINDINGS);
    expect(rows[0].business_rule_axis_status).toBe(AXIS_STATES.RESEARCHED_NO_FINDINGS);
    expect(rows[0].inspected_at).toBeTruthy();
    expect(rows[0].retrieved_at).toBeTruthy();

    // A fonte também existe como SOURCE (discovery) — com zero findings.
    const sources = await store.listSources({ tenantId: TENANT, runId: run.id, benchmarkId: 'mature' });
    expect(sources).toHaveLength(1);
    expect(rows[0].source_id).toBe(sources[0].id);

    // E a evidência capturada fica ligada ao hash — mesmo sem achado.
    const evidence = await store.listEvidence({ tenantId: TENANT, runId: run.id, benchmarkId: 'mature' });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].content_hash).toBe(SOURCE.contentHash);
    expect(evidence[0].metadata.locator).toBe(`document:${SOURCE.url}`);

    expect(await store.listFindings({ tenantId: TENANT, runId: run.id })).toEqual([]);
  });

  test('hash do fetch diferente do hash da inspeção → INSPECTION_HASH_MISMATCH', async () => {
    const { service } = buildService();
    await openRun(service);

    await expect(service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mismatch',
      analyzedContentHash: 'sha256:OUTRO-conteudo',
      axisStatuses: NO_FINDINGS_AXES,
    })).rejects.toThrow(new RegExp(SEMANTIC_CODES.INSPECTION_HASH_MISMATCH));
  });

  test('re-captura da MESMA evidência com hash diferente → EVIDENCE_HASH_MISMATCH', async () => {
    const { service } = buildService();
    await openRun(service);

    await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: SOURCE.contentHash,
      axisStatuses: NO_FINDINGS_AXES,
    });

    await expect(service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: { ...SOURCE, contentHash: 'sha256:mature-doc-v2' },
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: 'sha256:mature-doc-v2',
      axisStatuses: NO_FINDINGS_AXES,
    })).rejects.toThrow(new RegExp(SEMANTIC_CODES.EVIDENCE_HASH_MISMATCH));
  });

  test('idempotente: mesma (fonte, contentHash) faz UPSERT e nunca duplica', async () => {
    const { service, store } = buildService();
    await openRun(service);

    const first = await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: SOURCE.contentHash,
      axisStatuses: NO_FINDINGS_AXES,
    });
    const second = await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: SOURCE.contentHash,
      axisStatuses: NO_FINDINGS_AXES,
    });

    expect(second.id).toBe(first.id);
    const run = await currentRun(store);
    expect(await store.listSourceInspections({ tenantId: TENANT, runId: run.id })).toHaveLength(1);
    expect(await store.listEvidence({ tenantId: TENANT, runId: run.id })).toHaveLength(1);
  });

  test('conteúdo NOVO da mesma fonte é uma NOVA inspeção (hash distinto)', async () => {
    const { service, store } = buildService();
    await openRun(service);

    await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-mature-doc',
      analyzedContentHash: SOURCE.contentHash,
      axisStatuses: NO_FINDINGS_AXES,
    });
    await service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: { ...SOURCE, contentHash: 'sha256:mature-doc-v2' },
      evidenceRef: 'ev-mature-doc-v2',
      analyzedContentHash: 'sha256:mature-doc-v2',
      axisStatuses: NO_FINDINGS_AXES,
    });

    const run = await currentRun(store);
    expect(await store.listSourceInspections({ tenantId: TENANT, runId: run.id })).toHaveLength(2);
  });

  test('benchmark fora do discovery set é recusado', async () => {
    const { service } = buildService();
    await openRun(service);
    await expect(service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'nao-registrado',
      source: SOURCE,
      evidenceRef: 'ev-x',
      analyzedContentHash: SOURCE.contentHash,
      axisStatuses: NO_FINDINGS_AXES,
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK));
  });

  test('inspeção sem contentHash é recusada (evidência sem hash não é prova)', async () => {
    const { service } = buildService();
    await openRun(service);
    await expect(service.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: { ...SOURCE, contentHash: null },
      evidenceRef: 'ev-x',
      axisStatuses: NO_FINDINGS_AXES,
    })).rejects.toThrow(/benchmark_source_inspection_hash_required/);
  });
});

describe('T-B2 — o runner/supervisor registra inspeção mesmo com ZERO achados', () => {
  const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
  const {
    createBenchmarkResearchSupervisor,
    RESEARCH_RUN_OUTCOMES,
  } = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
  const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');

  const silent = { info() {}, warn() {}, error() {}, debug() {} };

  function zeroFindingProviders() {
    return {
      search: async () => ({ candidates: [{ url: SOURCE.url, title: 'docs', specificity: 'SPECIFIC' }] }),
      fetch: async () => ({ httpStatus: 200, contentType: 'text/html', content: '<html>nada novo</html>', contentHash: SOURCE.contentHash }),
      inspectDocumentation: async () => ({ sections: ['Recursos'], capabilities: [], journeys: [], rules: [] }),
      inspectApiDocs: async () => ({ operations: [], capabilities: [], journeys: [], rules: [] }),
      captureEvidence: async ({ contentHash }) => ({ evidenceRef: 'ev-mature-doc', contentHash }),
    };
  }

  test('supervisor persiste inspeção + evidência e o benchmark vira ANALYZED com 0 achados', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const supervisor = createBenchmarkResearchSupervisor({
      store,
      registry: createToolRegistry({ logger: silent }),
      providers: zeroFindingProviders(),
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      logger: silent,
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'inspection-supervisor-v1',
      benchmarkIds: ['mature'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({
      vertical: VERTICAL,
      plan: {
        benchmarks: [{
          benchmarkId: 'mature',
          name: 'Mature Vendor',
          archetype: 'independent-gym',
          declaredSources: [{ url: SOURCE.url, tier: 5 }],
          query: 'mature vendor funcionalidades',
        }],
      },
    });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(result.analyzed).toEqual(['mature']);

    const run = await currentRun(store);
    const inspections = await store.listSourceInspections({ tenantId: TENANT, runId: run.id, benchmarkId: 'mature' });
    expect(inspections).toHaveLength(1);
    expect(inspections[0].content_hash).toBe(SOURCE.contentHash);
    expect(await store.listFindings({ tenantId: TENANT, runId: run.id })).toEqual([]);

    const summary = await supervisor.summarize({ vertical: VERTICAL });
    expect(summary.analysedBenchmarks).toBe(1);
  });
});
