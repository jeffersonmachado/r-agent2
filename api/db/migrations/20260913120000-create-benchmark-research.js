'use strict';

/**
 * Migration: agregado PERSISTENTE da pesquisa competitiva de benchmarks.
 *
 * Contexto (gap confirmado 2026-09-13): o estado da pesquisa vivia em
 * `runs = new Map()` no `benchmarkResearchService`. Consequências reais:
 *   - um run "iniciado" desaparecia no restart do processo;
 *   - nenhum achado era auditável depois da execução (nem a evidência, nem a
 *     fonte);
 *   - o `toSamplePatch()` não tinha consumidor real e produziria um patch com
 *     `findingsInventory` em formato que o engine NÃO aceita (objeto em vez de
 *     array) — o erro só não aparecia porque ninguém aplicava o patch.
 *
 * Cinco tabelas, um agregado:
 *   benchmark_research_runs        — o run (tenant, vertical, versão de pesquisa)
 *   benchmark_research_subjects    — estado de ANÁLISE por benchmark do run
 *   benchmark_research_sources     — fontes declaradas/verificadas
 *   benchmark_research_evidence    — diário APPEND-ONLY de evidência
 *   benchmark_research_findings    — achados com a cadeia finding→evidence→source
 *
 * Invariantes no banco:
 *   - `tenant_key` em todas as tabelas (pesquisa é tenant-scoped);
 *   - unicidade determinística por identidade para tornar retry/replay
 *     idempotentes (sem isso, reprocessar inflaria a curva de novidade);
 *   - evidência sem `updated_at`: append-only por construção (o model também
 *     não expõe update).
 *
 * Idempotente: cria apenas tabelas ausentes e usa `addIndexIfNotExists`.
 */

const { addIndexIfNotExists } = require('../migrations-helper');

const TABLES = Object.freeze([
  'benchmark_research_runs',
  'benchmark_research_subjects',
  'benchmark_research_sources',
  'benchmark_research_evidence',
  'benchmark_research_findings',
]);

async function existingTables(queryInterface) {
  const tables = await queryInterface.showAllTables();
  return new Set(tables.map((table) => (typeof table === 'string' ? table : table.tableName)));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const present = await existingTables(queryInterface);

    if (!present.has('benchmark_research_runs')) {
      await queryInterface.createTable('benchmark_research_runs', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        vertical: { type: Sequelize.STRING(64), allowNull: false },
        research_version: { type: Sequelize.STRING(128), allowNull: false },
        state: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'RESEARCH_DISCOVERY_OPEN' },
        holdout_benchmark_id: { type: Sequelize.STRING(128), allowNull: true },
        saturation_reached: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        registered_at: { type: Sequelize.DATE, allowNull: false },
        discovery_set: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_runs', ['tenant_key', 'vertical', 'research_version'], {
        name: 'benchmark_research_runs_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_runs', ['tenant_key', 'vertical'], {
        name: 'benchmark_research_runs_tenant_vertical_idx',
      });
    }

    if (!present.has('benchmark_research_subjects')) {
      await queryInterface.createTable('benchmark_research_subjects', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: false },
        benchmark_id: { type: Sequelize.STRING(128), allowNull: false },
        discovery_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        analyzed_at: { type: Sequelize.DATE, allowNull: true },
        research_version: { type: Sequelize.STRING(128), allowNull: true },
        findings_inventory: { type: Sequelize.JSONB, allowNull: true },
        market_archetype_mapping: { type: Sequelize.JSONB, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_subjects', ['tenant_key', 'run_id', 'benchmark_id'], {
        name: 'benchmark_research_subjects_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_subjects', ['tenant_key', 'run_id'], {
        name: 'benchmark_research_subjects_run_idx',
      });
    }

    if (!present.has('benchmark_research_sources')) {
      await queryInterface.createTable('benchmark_research_sources', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: false },
        benchmark_id: { type: Sequelize.STRING(128), allowNull: false },
        url: { type: Sequelize.STRING(2048), allowNull: false },
        tier: { type: Sequelize.INTEGER, allowNull: true },
        specificity: { type: Sequelize.STRING(32), allowNull: true },
        http_status: { type: Sequelize.INTEGER, allowNull: true },
        verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        verification_state: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'UNVERIFIED' },
        verified_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_sources', ['tenant_key', 'run_id', 'benchmark_id', 'url'], {
        name: 'benchmark_research_sources_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_sources', ['tenant_key', 'run_id'], {
        name: 'benchmark_research_sources_run_idx',
      });
    }

    if (!present.has('benchmark_research_evidence')) {
      await queryInterface.createTable('benchmark_research_evidence', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: false },
        benchmark_id: { type: Sequelize.STRING(128), allowNull: false },
        source_id: { type: Sequelize.STRING(64), allowNull: true },
        evidence_ref: { type: Sequelize.STRING(512), allowNull: false },
        content_hash: { type: Sequelize.STRING(128), allowNull: true },
        http_status: { type: Sequelize.INTEGER, allowNull: true },
        captured_at: { type: Sequelize.DATE, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        // Append-only: existe apenas created_at, nunca updated_at.
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_evidence', ['tenant_key', 'run_id', 'benchmark_id', 'evidence_ref'], {
        name: 'benchmark_research_evidence_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_evidence', ['tenant_key', 'run_id'], {
        name: 'benchmark_research_evidence_run_idx',
      });
    }

    if (!present.has('benchmark_research_findings')) {
      await queryInterface.createTable('benchmark_research_findings', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: false },
        benchmark_id: { type: Sequelize.STRING(128), allowNull: false },
        kind: { type: Sequelize.STRING(32), allowNull: false },
        external_name: { type: Sequelize.STRING(512), allowNull: true },
        canonical_id: { type: Sequelize.STRING(128), allowNull: true },
        classification: { type: Sequelize.STRING(16), allowNull: true },
        archetype: { type: Sequelize.STRING(64), allowNull: true },
        verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        verification_state: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'UNVERIFIED' },
        source_id: { type: Sequelize.STRING(64), allowNull: true },
        evidence_id: { type: Sequelize.STRING(64), allowNull: true },
        recorded_at: { type: Sequelize.DATE, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_findings', ['tenant_key', 'run_id', 'benchmark_id'], {
        name: 'benchmark_research_findings_run_idx',
      });
      await addIndexIfNotExists(queryInterface, 'benchmark_research_findings', ['tenant_key', 'run_id', 'verified'], {
        name: 'benchmark_research_findings_verified_idx',
      });
    }
  },

  async down(queryInterface) {
    const present = await existingTables(queryInterface);
    // Ordem inversa de dependência lógica (agregado → run).
    for (const table of [...TABLES].reverse()) {
      if (present.has(table)) await queryInterface.dropTable(table);
    }
  },
};
