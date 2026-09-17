'use strict';

/**
 * Migration: PROPOSTAS DE MUDANÇA da pesquisa de benchmarks.
 *
 * Política nova (2026-09-17): a pesquisa competitiva NUNCA aplica mudança
 * diretamente no sample versionado (`config/benchmarks/<vertical>.json`).
 * Ela gera uma PROPOSTA persistida com avaliação documentada (o que muda,
 * prós, contras, riscos, avaliação prática) que exige APROVAÇÃO humana —
 * com ressalvas registradas — antes de ser aplicada.
 *
 * `benchmark_research_change_proposals`:
 *   - id determinístico `brcp-<sha256(vertical|runId|patchSha256)>` —
 *     a MESMA proposta (mesmo patch, mesmo run) é idempotente; depois de um
 *     estado terminal (applied/rejected), uma nova proposta do mesmo patch é
 *     uma nova versão determinística (contador no hash);
 *   - `patch` + `patch_sha256`: o conteúdo proposto e o binding de integridade
 *     (apply recompute o hash — patch adulterado é `patch_tampered`);
 *   - `evaluation`: o documento de avaliação derivado SÓ de dados reais;
 *   - `review_token_sha256` + `review_token_expires_at`: hash do token HMAC
 *     emitido no review (nunca o token em claro);
 *   - `caveats`: ressalvas registradas na aprovação.
 *
 * `run_id` é FK LÓGICA a `benchmark_research_runs.id` — o agregado de
 * pesquisa não usa constraints físicas (ver 20260913120000).
 *
 * Idempotente: cria apenas quando a tabela está ausente e usa
 * `addIndexIfNotExists`.
 */

const { addIndexIfNotExists } = require('../migrations-helper');

const TABLE = 'benchmark_research_change_proposals';

async function tablePresent(queryInterface) {
  const tables = await queryInterface.showAllTables();
  return tables.map((table) => (typeof table === 'string' ? table : table.tableName)).includes(TABLE);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tablePresent(queryInterface)) return;

    await queryInterface.createTable(TABLE, {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      vertical: { type: Sequelize.STRING(64), allowNull: false },
      run_id: { type: Sequelize.STRING(64), allowNull: true },
      patch: { type: Sequelize.JSONB, allowNull: false },
      patch_sha256: { type: Sequelize.STRING(64), allowNull: false },
      evaluation: { type: Sequelize.JSONB, allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'proposed' },
      caveats: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      decision_reason: { type: Sequelize.TEXT, allowNull: true },
      proposed_by: { type: Sequelize.STRING(128), allowNull: false },
      reviewed_by: { type: Sequelize.STRING(128), allowNull: true },
      applied_by: { type: Sequelize.STRING(128), allowNull: true },
      review_token_sha256: { type: Sequelize.STRING(64), allowNull: true },
      review_token_expires_at: { type: Sequelize.DATE, allowNull: true },
      proposed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      applied_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    await addIndexIfNotExists(queryInterface, TABLE, ['vertical', 'status'], {
      name: 'benchmark_research_change_proposals_vertical_status_idx',
    });
    await addIndexIfNotExists(queryInterface, TABLE, ['run_id'], {
      name: 'benchmark_research_change_proposals_run_idx',
    });
  },

  async down(queryInterface) {
    if (await tablePresent(queryInterface)) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
