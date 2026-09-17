'use strict';

/**
 * CHANGE PROPOSALS — a pesquisa de benchmarks NUNCA escreve a amostra sem
 * aprovação humana (política de 2026-09-17).
 *
 * Mesma disciplina de `benchmarkResearchPersistence.test.js`: Postgres REAL
 * (`DATABASE_URL`), nada de banco falso — o que está sob teste é a autoridade
 * durável das propostas (`benchmark_research_change_proposals`):
 *
 *   - o fluxo completo create → review → approve (com ressalvas) → apply é
 *     exercitado contra o serviço real, o sample real (cópia isolada por
 *     vertical de teste) e o engine real de suficiência;
 *   - cada recusa fail-closed é provada: sem token, token de outro revisor,
 *     auto-aprovação, status errado, patch adulterado, rejeição sem razão;
 *   - a idempotência do id determinístico e o versionamento `-vN` após estado
 *     terminal são provados por SQL cru, independente do código sob teste;
 *   - o sample de teste é SEMPRE restaurado/removido ao final — nada aqui
 *     toca `config/benchmarks/fitness.json`.
 *
 * Requisitos: `npm run db:migrate` aplicado (migration
 * `20260917120000-create-benchmark-research-change-proposals.js`).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { connect, close, getSequelize } = require('../../../api/db/sequelize');
const { createBenchmarkResearchStore } = require('../../../api/services/benchmark/benchmarkResearchStore');
const { createBenchmarkResearchService } = require('../../../api/services/benchmark/benchmarkResearchService');
const {
  createBenchmarkChangeProposalService,
  PROPOSAL_ERROR_CODES,
} = require('../../../api/services/benchmark/benchmarkChangeProposalService');
const { completeAnalysisEvidence } = require('../../helpers/benchmarkAnalysisEvidence');

const SAMPLES_DIR = path.join(__dirname, '..', '..', '..', 'config', 'benchmarks');

const RUN_SEED = crypto.randomBytes(4).toString('hex');
const TENANT = `test-brcp-${RUN_SEED}`;
const VERTICAL = `__testbrcp${RUN_SEED}`;
const RESEARCH_VERSION = `brcp-research-${RUN_SEED}`;
const SAMPLE_PATH = path.join(SAMPLES_DIR, `${VERTICAL}.json`);

const PROPOSER = 'proposer-user';
const REVIEWER = 'reviewer-user';
const REVIEWER_B = 'reviewer-user-b';
const SIGNING_KEY = `jest-brcp-signing-key-${RUN_SEED}-32bytes-minimum`;

/** Cópia isolada do sample real de fitness, com a vertical reescrita. */
function seedTestSample() {
  const real = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, 'fitness.json'), 'utf8'));
  const copy = { ...real, vertical: VERTICAL };
  fs.writeFileSync(SAMPLE_PATH, `${JSON.stringify(copy, null, 2)}\n`, 'utf8');
  return copy;
}

function readTestSample() {
  return JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
}

function freshResearchService() {
  return createBenchmarkResearchService({ store: createBenchmarkResearchStore() });
}

/** Serviço de propostas real: patch construído do store Postgres, engine real. */
function freshProposalService() {
  const store = createBenchmarkResearchStore();
  const research = createBenchmarkResearchService({ store });
  return createBenchmarkChangeProposalService({
    signingKey: SIGNING_KEY,
    buildPatch: async ({ vertical, priorSample }) => {
      const run = await store.getRun({ tenantId: TENANT, vertical });
      const patch = await research.buildSamplePatch({
        tenantId: TENANT,
        vertical,
        inventoryVersion: priorSample?.inventoryVersion || null,
        priorSample,
      });
      return { patch, runId: run?.id || null };
    },
  });
}

/** Consulta CRUA — prova independente do código sob teste. */
async function rawQuery(sql, params = []) {
  return getSequelize().query(sql, {
    replacements: params,
    type: getSequelize().constructor.QueryTypes.SELECT,
  });
}

async function proposalRow(id) {
  const rows = await rawQuery(
    'SELECT id, status, proposed_by, reviewed_by, applied_by, caveats, decision_reason, patch_sha256, review_token_sha256 FROM benchmark_research_change_proposals WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

/** Abre um run novo e deixa o benchmark ANALISADO (estado legítimo completo). */
async function openRunWithAnalysis({ researchVersion, benchmarkId, externalName }) {
  const service = freshResearchService();
  await service.openDiscoverySet({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion,
    benchmarkIds: [benchmarkId],
    holdoutBenchmarkId: null,
  });
  await completeAnalysisEvidence(service, {
    tenantId: TENANT,
    vertical: VERTICAL,
    benchmarkId,
    externalName,
  });
  await service.markAnalyzed({
    tenantId: TENANT,
    vertical: VERTICAL,
    benchmarkId,
    marketArchetypeMapping: { archetype: 'integration-first-api', rationale: 'fixture de teste' },
  });
  return service;
}

describe('Change proposals — pesquisa propõe, humano aprova, só então aplica', () => {
  let sampleBackup;

  beforeAll(async () => {
    await connect(1, 0);
    sampleBackup = seedTestSample();
  });

  afterEach(() => {
    // Qualquer teste que aplicou uma proposta deixa o sample como estava.
    if (fs.existsSync(SAMPLE_PATH)) {
      fs.writeFileSync(SAMPLE_PATH, `${JSON.stringify(sampleBackup, null, 2)}\n`, 'utf8');
    }
  });

  afterAll(async () => {
    try {
      await rawQuery('DELETE FROM benchmark_research_change_proposals WHERE vertical = ?', [VERTICAL]);
      for (const table of [
        'benchmark_research_findings',
        'benchmark_research_evidence',
        'benchmark_research_sources',
        'benchmark_source_inspections',
        'benchmark_research_subjects',
        'benchmark_research_runs',
      ]) {
        await rawQuery(`DELETE FROM ${table} WHERE tenant_key = ?`, [TENANT]);
      }
    } finally {
      if (fs.existsSync(SAMPLE_PATH)) fs.unlinkSync(SAMPLE_PATH);
      await close();
    }
  });

  test('happy path: create → review → approve (com ressalvas) → apply escreve o sample e persiste cada transição', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-happy`,
      benchmarkId: 'evo-w12',
      externalName: 'Gestão de matrículas',
    });
    const service = freshProposalService();

    const { proposal, created } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    expect(created).toBe(true);
    expect(proposal.id).toMatch(/^brcp-[0-9a-f]{48}$/);
    expect(proposal.status).toBe('proposed');
    expect(proposal.runId).toBeTruthy();
    expect(proposal.proposedBy).toBe(PROPOSER);
    // Avaliação documentada, derivada de dados reais.
    expect(proposal.evaluation.whatChanges.some((change) => change.benchmarkId === 'evo-w12' && change.type === 'update')).toBe(true);
    expect(proposal.evaluation.sufficiency.before).toBeTruthy();
    expect(proposal.evaluation.sufficiency.after).toBeTruthy();
    expect(proposal.evaluation.recommendation.verdict).toMatch(/recommended|caution|not_recommended/);
    expect(proposal.evaluation.nonGoals[0]).toContain('Não implementa capabilities');
    // O sample NÃO foi tocado pela criação da proposta.
    expect(readTestSample()).toEqual(sampleBackup);

    const review = await service.startReview({ proposalId: proposal.id, actor: REVIEWER });
    expect(review.reviewToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(new Date(review.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Só o HASH do token é persistido — nunca o token em claro.
    const reviewRow = await proposalRow(proposal.id);
    expect(reviewRow.review_token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewRow.review_token_sha256).not.toBe(review.reviewToken);

    const approved = await service.approveProposal({
      proposalId: proposal.id,
      actor: REVIEWER,
      reviewToken: review.reviewToken,
      caveats: ['revalidar fontes do evo-w12 no próximo ciclo'],
      reason: 'cobertura do arquétipo melhora sem regressão de gates',
    });
    expect(approved.proposal.status).toBe('approved');
    expect(approved.proposal.caveats).toEqual(['revalidar fontes do evo-w12 no próximo ciclo']);
    expect(approved.proposal.reviewedBy).toBe(REVIEWER);

    const { proposal: applied, applyResult } = await service.applyProposal({
      proposalId: proposal.id,
      actor: REVIEWER,
    });
    expect(applied.status).toBe('applied');
    expect(applied.appliedBy).toBe(REVIEWER);
    expect(applyResult.applied).toEqual(['evo-w12']);
    // A escrita REAL aconteceu: o benchmark consta analisado no sample.
    const written = readTestSample();
    expect(written.benchmarks.find((benchmark) => benchmark.id === 'evo-w12').analyzedAt).toBeTruthy();

    // Prova independente, por SQL cru.
    const row = await proposalRow(proposal.id);
    expect(row.status).toBe('applied');
    expect(row.proposed_by).toBe(PROPOSER);
    expect(row.reviewed_by).toBe(REVIEWER);
    expect(row.applied_by).toBe(REVIEWER);
    expect(row.caveats).toEqual(['revalidar fontes do evo-w12 no próximo ciclo']);
  });

  test('idempotência: recriar a MESMA proposta devolve o mesmo id; após applied, nova proposta é versão nova', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-idem`,
      benchmarkId: 'tecnofit',
      externalName: 'Controle de acesso por catraca',
    });
    const service = freshProposalService();

    const first = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    const again = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    expect(again.created).toBe(false);
    expect(again.proposal.id).toBe(first.proposal.id);
    expect(again.proposal.status).toBe('proposed');

    const review = await service.startReview({ proposalId: first.proposal.id, actor: REVIEWER });
    await service.approveProposal({
      proposalId: first.proposal.id,
      actor: REVIEWER,
      reviewToken: review.reviewToken,
    });
    await service.applyProposal({ proposalId: first.proposal.id, actor: REVIEWER });

    // Mesmo patch, mesmo run — mas a anterior está em estado TERMINAL: v2.
    const second = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    expect(second.created).toBe(true);
    expect(second.proposal.id).not.toBe(first.proposal.id);
    expect(second.proposal.id).toMatch(/^brcp-[0-9a-f]{48}$/);
    expect(second.proposal.patchSha256).toBe(first.proposal.patchSha256);

    const rows = await rawQuery(
      'SELECT id, status FROM benchmark_research_change_proposals WHERE vertical = ? AND patch_sha256 = ? ORDER BY proposed_at',
      [VERTICAL, first.proposal.patchSha256],
    );
    expect(rows.map((row) => row.status)).toEqual(['applied', 'proposed']);
  });

  test('approve sem token é recusado (review_token_required) e nada muda', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-notoken`,
      benchmarkId: 'evo-w12',
      externalName: 'App do aluno',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });

    await expect(service.approveProposal({
      proposalId: proposal.id,
      actor: REVIEWER,
    })).rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.TOKEN_REQUIRED });

    expect((await proposalRow(proposal.id)).status).toBe('proposed');
  });

  test('token emitido para outro revisor é recusado (review_token_reviewer_mismatch)', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-mismatch`,
      benchmarkId: 'evo-w12',
      externalName: 'Cobrança recorrente',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    const review = await service.startReview({ proposalId: proposal.id, actor: REVIEWER });

    await expect(service.approveProposal({
      proposalId: proposal.id,
      actor: REVIEWER_B,
      reviewToken: review.reviewToken,
    })).rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.TOKEN_REVIEWER_MISMATCH });

    // Token adulterado também não passa (integridade HMAC).
    await expect(service.approveProposal({
      proposalId: proposal.id,
      actor: REVIEWER,
      reviewToken: `${review.reviewToken}x`,
    })).rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.TOKEN_INVALID });

    expect((await proposalRow(proposal.id)).status).toBe('proposed');
  });

  test('auto-aprovação é negada (self_approval_denied) mesmo com token válido', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-self`,
      benchmarkId: 'tecnofit',
      externalName: 'Catraca biométrica',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    const review = await service.startReview({ proposalId: proposal.id, actor: PROPOSER });

    await expect(service.approveProposal({
      proposalId: proposal.id,
      actor: PROPOSER,
      reviewToken: review.reviewToken,
    })).rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.SELF_APPROVAL });

    expect((await proposalRow(proposal.id)).status).toBe('proposed');
  });

  test('approve/apply fora de status são recusados (proposal_invalid_status)', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-status`,
      benchmarkId: 'evo-w12',
      externalName: 'Treino personalizado',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });

    // Aplicar SEM aprovar: não existe atalho.
    await expect(service.applyProposal({ proposalId: proposal.id, actor: REVIEWER }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.INVALID_STATUS });

    const review = await service.startReview({ proposalId: proposal.id, actor: REVIEWER });
    await service.approveProposal({ proposalId: proposal.id, actor: REVIEWER, reviewToken: review.reviewToken });

    // Aprovar de novo: status já não é proposed.
    await expect(service.approveProposal({ proposalId: proposal.id, actor: REVIEWER, reviewToken: review.reviewToken }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.INVALID_STATUS });

    expect((await proposalRow(proposal.id)).status).toBe('approved');
    expect(readTestSample()).toEqual(sampleBackup);
  });

  test('patch adulterado no banco entre approve e apply aborta (patch_tampered)', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-tamper`,
      benchmarkId: 'tecnofit',
      externalName: 'Gestão de contratos',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });
    const review = await service.startReview({ proposalId: proposal.id, actor: REVIEWER });
    await service.approveProposal({ proposalId: proposal.id, actor: REVIEWER, reviewToken: review.reviewToken });

    // Adulteração DIRETA no banco (simula escrita fora do fluxo).
    const tampered = { ...proposal.patch, researchVersion: `${RESEARCH_VERSION}-tampered` };
    await getSequelize().query(
      'UPDATE benchmark_research_change_proposals SET patch = ? WHERE id = ?',
      { replacements: [JSON.stringify(tampered), proposal.id] },
    );

    await expect(service.applyProposal({ proposalId: proposal.id, actor: REVIEWER }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.PATCH_TAMPERED });

    // Nada foi escrito no sample; a proposta continua approved (não aplicada).
    expect(readTestSample()).toEqual(sampleBackup);
    expect((await proposalRow(proposal.id)).status).toBe('approved');
  });

  test('rejeição exige razão documentada e registra o revisor', async () => {
    await openRunWithAnalysis({
      researchVersion: `${RESEARCH_VERSION}-reject`,
      benchmarkId: 'evo-w12',
      externalName: 'Aplicativo do aluno',
    });
    const service = freshProposalService();
    const { proposal } = await service.createProposal({ vertical: VERTICAL, actor: PROPOSER });

    await expect(service.rejectProposal({ proposalId: proposal.id, actor: REVIEWER }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.REASON_REQUIRED });

    const rejected = await service.rejectProposal({
      proposalId: proposal.id,
      actor: REVIEWER,
      reason: 'fonte oficial do fornecedor mudou; refazer a pesquisa',
    });
    expect(rejected.proposal.status).toBe('rejected');
    expect(rejected.proposal.decisionReason).toBe('fonte oficial do fornecedor mudou; refazer a pesquisa');

    // Rejeitada é TERMINAL: nem approve nem apply passam.
    await expect(service.applyProposal({ proposalId: proposal.id, actor: REVIEWER }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.INVALID_STATUS });
    expect(readTestSample()).toEqual(sampleBackup);
  });

  test('list/get: filtros por vertical e status; proposta desconhecida é null', async () => {
    const service = freshProposalService();
    const all = await service.listProposals({ vertical: VERTICAL });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((proposal) => proposal.vertical === VERTICAL)).toBe(true);

    const applied = await service.listProposals({ vertical: VERTICAL, status: 'applied' });
    expect(applied.every((proposal) => proposal.status === 'applied')).toBe(true);

    const known = await service.getProposal(all[0].id);
    expect(known.id).toBe(all[0].id);
    expect(await service.getProposal('brcp-inexistente')).toBeNull();

    await expect(service.listProposals({ status: 'bogus' }))
      .rejects.toMatchObject({ code: PROPOSAL_ERROR_CODES.INVALID_STATUS });
  });
});
