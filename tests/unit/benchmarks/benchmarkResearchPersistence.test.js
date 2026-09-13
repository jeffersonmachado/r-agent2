'use strict';

/**
 * §B4/§B5/§B6 — PERSISTÊNCIA REAL da pesquisa de benchmarks.
 *
 * Este arquivo NÃO usa banco falso. Ele fala com o Postgres configurado
 * (`DATABASE_URL`), porque o que está sob teste é exatamente a substituição de
 * `runs = new Map()` por uma AUTORIDADE durável:
 *
 *   - se o banco não estiver acessível, o teste FALHA (não é pulado, não cai
 *     para memória) — uma suíte verde sobre um banco ausente provaria nada;
 *   - o "restart" é simulado descartando TODAS as instâncias locais e criando
 *     store/serviço novos do zero; nenhum cache em processo pode explicar o
 *     resultado;
 *   - além do serviço, o teste confere as LINHAS no banco por SQL direto —
 *     prova independente do código sob teste.
 *
 * Requisitos: `npm run db:migrate` aplicado (migration
 * `20260913120000-create-benchmark-research.js`).
 */

const crypto = require('crypto');

const { connect, close } = require('../../../api/db/sequelize');
const { createBenchmarkResearchStore } = require('../../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');

const VERTICAL = 'fitness';
const RESEARCH_VERSION = 'fitness-research-persistence-v1';

/** Tenant único por execução: nada de colidir com dados de outra suíte. */
const TENANT = `test-benchmark-${crypto.randomBytes(4).toString('hex')}`;
const OTHER_TENANT = `${TENANT}-other`;

const OFFICIAL_SOURCE = {
  url: 'https://docs.example-vendor.test/features/membership-management',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
};

const GENERIC_SOURCE = {
  url: 'https://example-vendor.test/',
  tier: 5,
  verified: true,
  httpStatus: 200,
};

/** Instância NOVA de store+serviço — simula o processo depois do restart. */
function freshService() {
  return createBenchmarkResearchService({ store: createBenchmarkResearchStore() });
}

/**
 * Consulta CRUA no banco configurado — prova independente do código sob teste.
 * `replacements` (não `bind`) é o mecanismo suportado pelo dialeto do projeto.
 */
async function rawQuery(sql, params = []) {
  const { getSequelize } = require('../../../api/db/sequelize');
  const rows = await getSequelize().query(sql, { replacements: params, type: getSequelize().constructor.QueryTypes.SELECT });
  return rows;
}

describe('B4/B5 — a pesquisa de benchmarks sobrevive ao restart do processo', () => {
  beforeAll(async () => {
    // 1 tentativa, sem retry: banco indisponível DEVE falhar aqui e agora.
    await connect(1, 0);
  });

  afterAll(async () => {
    // Limpeza do agregado criado por esta suíte (ordem: dependentes → run).
    try {
      for (const table of [
        'benchmark_research_findings',
        'benchmark_research_evidence',
        'benchmark_research_sources',
        'benchmark_research_subjects',
        'benchmark_research_runs',
      ]) {
        await rawQuery(`DELETE FROM ${table} WHERE tenant_key IN (?, ?)`, [TENANT, OTHER_TENANT]);
      }
    } catch (error) {
      // A limpeza não pode mascarar o resultado dos testes; mas falha é visível.
      // eslint-disable-next-line no-console
      console.warn('[benchmarkResearchPersistence] limpeza falhou:', error.message);
    }
    await close();
  });

  test('run iniciado, achado verificado e análise persistem após descartar todo estado local', async () => {
    const first = freshService();
    await first.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: RESEARCH_VERSION,
      benchmarkIds: ['evo', 'tecnofit', 'zenplanner'],
      holdoutBenchmarkId: 'zenplanner',
    });

    await first.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'evo',
      kind: 'capability',
      externalName: 'Gestão de matrículas',
      canonicalId: 'membership.manage',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-persist-1',
      classification: 'REQUIRED',
    });
    await first.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'evo',
      marketArchetypeMapping: { archetype: 'integration-first-api', rationale: 'API oficial' },
    });

    const before = await first.summarize({ tenantId: TENANT, vertical: VERTICAL });
    expect(before.analysedBenchmarks).toBe(1);

    // ---- "restart": nenhuma referência anterior sobrevive -------------------
    const second = freshService();
    const after = await second.summarize({ tenantId: TENANT, vertical: VERTICAL });

    expect(after.state).toBe('RESEARCH_IN_PROGRESS');
    expect(after.researchVersion).toBe(RESEARCH_VERSION);
    expect(after.discoverySet).toEqual(['evo', 'tecnofit', 'zenplanner']);
    expect(after.holdoutBenchmarkId).toBe('zenplanner');
    expect(after.analysedBenchmarks).toBe(1);
    expect(after.unanalysedBenchmarks).toEqual(['tecnofit', 'zenplanner']);

    const evo = after.benchmarks.find((benchmark) => benchmark.id === 'evo');
    expect(evo.analyzedAt).toBeTruthy();
    expect(evo.verifiedFindings).toBe(1);
    expect(Array.isArray(evo.findingsInventory)).toBe(true);
    expect(evo.findingsInventory).toHaveLength(1);

    // Prova INDEPENDENTE do código: as linhas estão no banco.
    const runRows = await rawQuery('SELECT id, state FROM benchmark_research_runs WHERE tenant_key = ?', [TENANT]);
    expect(runRows).toHaveLength(1);
    const findingRows = await rawQuery(
      'SELECT kind, verified, evidence_id, source_id FROM benchmark_research_findings WHERE tenant_key = ?',
      [TENANT],
    );
    expect(findingRows).toHaveLength(1);
    expect(findingRows[0].verified).toBe(true);
    expect(findingRows[0].evidence_id).toBeTruthy();
    expect(findingRows[0].source_id).toBeTruthy();
    const evidenceRows = await rawQuery(
      'SELECT evidence_ref FROM benchmark_research_evidence WHERE tenant_key = ?',
      [TENANT],
    );
    expect(evidenceRows.map((row) => row.evidence_ref)).toEqual(['ev-persist-1']);
  });

  test('isolamento por tenant: nenhuma leitura cruza tenant', async () => {
    const other = freshService();
    const summary = await other.summarize({ tenantId: OTHER_TENANT, vertical: VERTICAL });
    expect(summary.state).toBe('RESEARCH_NOT_STARTED');
    expect(summary.discoverySet).toEqual([]);
    expect(summary.benchmarks).toEqual([]);

    await expect(other.recordFinding({
      tenantId: OTHER_TENANT,
      vertical: VERTICAL,
      benchmarkId: 'evo',
      kind: 'capability',
      externalName: 'x',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-outro',
    })).rejects.toThrow(/research_discovery_set_not_registered/);

    // O run do outro tenant não foi criado por efeito colateral.
    const rows = await rawQuery('SELECT count(*)::int AS n FROM benchmark_research_runs WHERE tenant_key = ?', [OTHER_TENANT]);
    expect(rows[0].n).toBe(0);
  });

  test('idempotência: reabrir o mesmo run e repetir o mesmo achado não duplica história', async () => {
    const service = freshService();
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: RESEARCH_VERSION,
      benchmarkIds: ['evo', 'tecnofit', 'zenplanner'],
      holdoutBenchmarkId: 'zenplanner',
    });

    const firstRecord = await service.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'tecnofit',
      kind: 'capability',
      externalName: 'Controle de acesso por catraca',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-persist-2',
    });
    const secondRecord = await service.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'tecnofit',
      kind: 'capability',
      externalName: 'Controle de acesso por catraca',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-persist-2',
    });

    expect(secondRecord.id).toBe(firstRecord.id);

    const rows = await rawQuery(
      `SELECT count(*)::int AS n FROM benchmark_research_findings
        WHERE tenant_key = ? AND benchmark_id = 'tecnofit'`,
      [TENANT],
    );
    expect(rows[0].n).toBe(1);

    // Evidência é append-only e idempotente: a repetição NÃO cria uma 2ª prova.
    const evidence = await rawQuery(
      `SELECT count(*)::int AS n FROM benchmark_research_evidence
        WHERE tenant_key = ? AND evidence_ref = 'ev-persist-2'`,
      [TENANT],
    );
    expect(evidence[0].n).toBe(1);
  });

  test('B6 — achado sem evidência é UNVERIFIED, não entra no inventário e não certifica nada', async () => {
    const service = freshService();
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: `${RESEARCH_VERSION}-b6`,
      benchmarkIds: ['pacto'],
      holdoutBenchmarkId: null,
    });

    // Fonte genérica (homepage): fornecedor existe, capability não é provada.
    const finding = await service.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'pacto',
      kind: 'capability',
      externalName: 'App do aluno',
      source: GENERIC_SOURCE,
      evidenceRef: 'ev-nao-prova',
    });
    expect(finding.verified).toBe(false);
    expect(finding.evidenceId).toBeNull();

    // Sem achado verificado, a análise é RECUSADA — não existe "analisado" sem prova.
    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'pacto',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(/research_analysis_evidence_incomplete/);

    const rows = await rawQuery(
      `SELECT verified, evidence_id FROM benchmark_research_findings
        WHERE tenant_key = ? AND benchmark_id = 'pacto'`,
      [TENANT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(false);
    expect(rows[0].evidence_id).toBeNull();

    const subject = await rawQuery(
      `SELECT analyzed_at, findings_inventory FROM benchmark_research_subjects
        WHERE tenant_key = ? AND benchmark_id = 'pacto'`,
      [TENANT],
    );
    expect(subject[0].analyzed_at).toBeNull();
    expect(subject[0].findings_inventory).toBeNull();

    // O patch do sample não pode declarar análise para este benchmark.
    const patch = await service.buildSamplePatch({ tenantId: TENANT, vertical: VERTICAL });
    const pacto = patch.benchmarks.find((benchmark) => benchmark.id === 'pacto');
    expect(pacto.analyzedAt).toBeNull();
    expect(pacto.findingsInventory).toBeNull();
    expect(pacto.novelty.newCapabilities).toEqual([]);
  });

  test('holdout não pode ser analisado antes da saturação declarada (§13, persistido)', async () => {
    const service = freshService();
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: `${RESEARCH_VERSION}-holdout`,
      benchmarkIds: ['zenplanner'],
      holdoutBenchmarkId: 'zenplanner',
    });
    await service.recordFinding({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'zenplanner',
      kind: 'capability',
      externalName: 'WOD tracking',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-holdout',
    });

    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'zenplanner',
      marketArchetypeMapping: { archetype: 'crossfit-box' },
    })).rejects.toThrow(/research_holdout_analyzed_before_saturation/);

    await service.markApparentSaturation({ tenantId: TENANT, vertical: VERTICAL });

    // A saturação declarada também sobrevive a um novo ciclo de vida do processo.
    const restarted = freshService();
    const after = await restarted.summarize({ tenantId: TENANT, vertical: VERTICAL });
    expect(after.saturationReached).toBe(true);

    const analyzed = await restarted.markAnalyzed({
      tenantId: TENANT,
      vertical: VERTICAL,
      benchmarkId: 'zenplanner',
      marketArchetypeMapping: { archetype: 'crossfit-box' },
    });
    expect(analyzed.analyzedAt).toBeTruthy();
  });
});
