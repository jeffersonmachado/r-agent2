'use strict';

/**
 * T-B2 — Persistência REAL das inspeções de fonte (Postgres, fail-closed).
 *
 * Mesmo disciplina de `benchmarkResearchPersistence.test.js`: este arquivo fala
 * com o Postgres configurado (`DATABASE_URL`) e FALHA se o banco não estiver
 * acessível — uma suíte verde sobre banco ausente provaria nada. O "restart" é
 * simulado descartando TODAS as instâncias locais e recriando store/serviço.
 *
 * Requisitos: migration `20260915000000-create-benchmark-source-inspections.js`
 * aplicada (`npm run db:migrate`).
 */

const crypto = require('crypto');

const { connect, close } = require('../../../api/db/sequelize');
const { createBenchmarkResearchStore } = require('../../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');

const VERTICAL = 'fitness';
const RESEARCH_VERSION = 'inspection-persistence-v1';

/** Tenant único por execução: nada de colidir com dados de outra suíte. */
const TENANT = `test-benchmark-inspection-${crypto.randomBytes(4).toString('hex')}`;

const SOURCE = {
  url: 'https://docs.mature-vendor.test/features',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
  contentHash: 'sha256:inspection-persist-fixture-v1',
};

function freshService() {
  return createBenchmarkResearchService({ store: createBenchmarkResearchStore() });
}

async function rawQuery(sql, params = []) {
  const { getSequelize } = require('../../../api/db/sequelize');
  return getSequelize().query(sql, { replacements: params, type: getSequelize().constructor.QueryTypes.SELECT });
}

describe('T-B2 — inspeção de fonte sobrevive ao restart do processo', () => {
  beforeAll(async () => {
    await connect(1, 0);
  });

  afterAll(async () => {
    try {
      await rawQuery('DELETE FROM benchmark_source_inspections WHERE tenant_key = ?', [TENANT]);
      for (const table of [
        'benchmark_research_findings',
        'benchmark_research_evidence',
        'benchmark_research_sources',
        'benchmark_research_subjects',
        'benchmark_research_runs',
      ]) {
        await rawQuery(`DELETE FROM ${table} WHERE tenant_key = ?`, [TENANT]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[benchmarkSourceInspectionPersistence] limpeza falhou:', error.message);
    }
    await close();
  });

  test('fonte inspecionada com ZERO achados persiste inspeção + evidência, e sobrevive ao restart', async () => {
    const first = freshService();
    await first.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: RESEARCH_VERSION,
      benchmarkIds: ['mature'],
      holdoutBenchmarkId: null,
    });

    await first.recordSourceInspection({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: SOURCE,
      evidenceRef: 'ev-inspection-persist-1',
      analyzedContentHash: SOURCE.contentHash,
      documentType: 'text/html',
      provider: 'native',
      axisStatuses: {
        CAPABILITY_AXIS: 'RESEARCHED_NO_FINDINGS',
        JOURNEY_AXIS: 'RESEARCHED_NO_FINDINGS',
        BUSINESS_RULE_AXIS: 'RESEARCHED_NO_FINDINGS',
      },
    });

    // ---- "restart": nenhuma referência anterior sobrevive -------------------
    const second = freshService();
    const store = createBenchmarkResearchStore();
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const inspections = await store.listSourceInspections({ tenantId: TENANT, runId: run.id, benchmarkId: 'mature' });

    expect(inspections).toHaveLength(1);
    expect(String(inspections[0].content_hash || inspections[0].contentHash)).toContain('sha256:inspection-persist-fixture-v1');

    // Prova INDEPENDENTE do código: a linha está no banco.
    const rows = await rawQuery(
      `SELECT url, content_hash, document_type, provider, capability_axis_status
         FROM benchmark_source_inspections WHERE tenant_key = ?`,
      [TENANT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe(SOURCE.url);
    expect(rows[0].content_hash).toBe(SOURCE.contentHash);
    expect(rows[0].document_type).toBe('text/html');
    expect(rows[0].capability_axis_status).toBe('RESEARCHED_NO_FINDINGS');

    const evidenceRows = await rawQuery(
      'SELECT evidence_ref, content_hash FROM benchmark_research_evidence WHERE tenant_key = ?',
      [TENANT],
    );
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0].content_hash).toBe(SOURCE.contentHash);

    // Inspeção persistida NÃO substitui eixo pesquisado: sem os três eixos em
    // estado RESEARCHED_*, a análise continua RECUSADA mesmo após o restart.
    await expect(second.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      inspections: {
        documentation: true,
        api: false,
        apiApplicable: false,
        apiNotApplicableRationale: 'fornecedor sem API pública documentada',
      },
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(/research_analysis_evidence_incomplete/);
  });

  test('ciclo completo pós-restart: eixos pesquisados + inspeção persistida → ANALYZED com 0 achados', async () => {
    const service = freshService();
    for (const axis of ['CAPABILITY_AXIS', 'JOURNEY_AXIS', 'BUSINESS_RULE_AXIS']) {
      await service.setAxisState({
        tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'mature', axis, state: 'RESEARCHED_NO_FINDINGS',
      });
    }
    await service.recordInspections({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      inspections: {
        documentation: true,
        api: false,
        apiApplicable: false,
        apiNotApplicableRationale: 'fornecedor sem API pública documentada',
      },
    });

    const analyzed = await service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      marketArchetypeMapping: { archetype: 'independent-gym', rationale: 'pesquisa completa sem novidade' },
    });
    expect(analyzed.analyzedAt).toBeTruthy();
    expect(analyzed.findingsInventory).toEqual([]);

    const subjectRows = await rawQuery(
      'SELECT analyzed_at, findings_inventory FROM benchmark_research_subjects WHERE tenant_key = ? AND benchmark_id = ?',
      [TENANT, 'mature'],
    );
    expect(subjectRows[0].analyzed_at).toBeTruthy();
    expect(subjectRows[0].findings_inventory).toEqual([]);
  });

  test('idempotência no Postgres: mesma (fonte, contentHash) não duplica a linha', async () => {
    const service = freshService();
    const args = {
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'mature',
      source: { ...SOURCE, contentHash: 'sha256:inspection-persist-fixture-v2' },
      evidenceRef: 'ev-inspection-persist-2',
      analyzedContentHash: 'sha256:inspection-persist-fixture-v2',
      axisStatuses: {
        CAPABILITY_AXIS: 'RESEARCHED_NO_FINDINGS',
        JOURNEY_AXIS: 'RESEARCHED_NO_FINDINGS',
        BUSINESS_RULE_AXIS: 'RESEARCHED_NO_FINDINGS',
      },
    };
    const first = await service.recordSourceInspection(args);
    const second = await service.recordSourceInspection(args);
    expect(second.id).toBe(first.id);

    const rows = await rawQuery(
      'SELECT count(*)::int AS n FROM benchmark_source_inspections WHERE tenant_key = ? AND content_hash = ?',
      [TENANT, 'sha256:inspection-persist-fixture-v2'],
    );
    expect(rows[0].n).toBe(1);
  });
});
