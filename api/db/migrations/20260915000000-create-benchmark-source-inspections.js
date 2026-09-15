'use strict';

/**
 * Migration: proveniência de INSPEÇÃO por fonte da pesquisa de benchmarks (T-B2).
 *
 * Contexto (gap confirmado 2026-09-15): evidência só era gravada dentro de
 * `recordFinding`. Uma fonte buscada + inspecionada com ZERO achados não
 * deixava proveniência alguma (contentHash, retrievedAt, inspectedAt,
 * documentType, estado por eixo) — e sem essa prova o critério de análise com
 * zero achados (T-B1) não é auditável depois do restart.
 *
 * Tabela: benchmark_source_inspections
 *   - `tenant_key` obrigatório (pesquisa é tenant-scoped);
 *   - identidade determinística calculada no store por
 *     `(tenant, run, benchmark, source, contentHash)`: re-inspeção do mesmo
 *     conteúdo é UPSERT; conteúdo novo é nova linha;
 *   - `content_hash` NOT NULL: inspeção sem hash não está ligada ao conteúdo
 *     analisado.
 *
 * Idempotente: cria apenas se ausente e usa `addIndexIfNotExists`.
 */

const { addIndexIfNotExists } = require('../migrations-helper');

const TABLE = 'benchmark_source_inspections';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const present = new Set(tables.map((table) => (typeof table === 'string' ? table : table.tableName)));
    if (present.has(TABLE)) return;

    await queryInterface.createTable(TABLE, {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      run_id: { type: Sequelize.STRING(64), allowNull: false },
      subject_id: { type: Sequelize.STRING(64), allowNull: false },
      benchmark_id: { type: Sequelize.STRING(128), allowNull: false },
      source_id: { type: Sequelize.STRING(64), allowNull: true },
      url: { type: Sequelize.STRING(2048), allowNull: false },
      content_hash: { type: Sequelize.STRING(128), allowNull: false },
      retrieved_at: { type: Sequelize.DATE, allowNull: false },
      inspected_at: { type: Sequelize.DATE, allowNull: false },
      document_type: { type: Sequelize.STRING(64), allowNull: true },
      provider: { type: Sequelize.STRING(128), allowNull: true },
      documentation_status: { type: Sequelize.STRING(32), allowNull: false },
      api_status: { type: Sequelize.STRING(32), allowNull: false },
      capability_axis_status: { type: Sequelize.STRING(48), allowNull: false },
      journey_axis_status: { type: Sequelize.STRING(48), allowNull: false },
      business_rule_axis_status: { type: Sequelize.STRING(48), allowNull: false },
      errors: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await addIndexIfNotExists(queryInterface, TABLE, ['tenant_key', 'run_id', 'benchmark_id'], {
      name: 'benchmark_source_inspections_benchmark_idx',
    });
    await addIndexIfNotExists(queryInterface, TABLE, ['tenant_key', 'run_id'], {
      name: 'benchmark_source_inspections_run_idx',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const present = new Set(tables.map((table) => (typeof table === 'string' ? table : table.tableName)));
    if (present.has(TABLE)) await queryInterface.dropTable(TABLE);
  },
};
