'use strict';

/**
 * Migration: agregado PERSISTENTE da DESCOBERTA AUTÔNOMA DE MERCADO.
 *
 * A camada de descoberta de mercado antecede o Discovery Set de benchmarks:
 * sem ela, o discovery set era "o que o chamador passou" e o config da
 * vertical (ex.: config/benchmarks/fitness.json) era a única fonte — 8
 * benchmarks e 9 arquétipos hardcoded, sem prova de que o mercado foi de fato
 * varrido. Estas tabelas tornam a descoberta auditável e sobrevivente a
 * restart:
 *
 *   market_discovery_runs   — o run (tenant, vertical, versão de descoberta)
 *   market_archetypes       — arquétipos descobertos/revalidados COM evidência
 *   market_candidates       — universo de candidatos (seeds + descobertos)
 *   market_discovery_sets   — discovery set selecionado + pré-registro do holdout
 *
 * Invariantes no banco:
 *   - `tenant_key` em todas as tabelas (descoberta é tenant-scoped SYSTEM);
 *   - unicidade determinística por identidade ⇒ retry/re-run idempotentes;
 *   - `deep_research_at` separado de `profiled_at`: profiling de candidato
 *     nunca é confundido com pesquisa profunda (âncora do anti-leakage).
 *
 * Idempotente: cria apenas tabelas ausentes e usa `addIndexIfNotExists`.
 */

const { addIndexIfNotExists } = require('../migrations-helper');

const TABLES = Object.freeze([
  'market_discovery_runs',
  'market_archetypes',
  'market_candidates',
  'market_discovery_sets',
]);

async function existingTables(queryInterface) {
  const tables = await queryInterface.showAllTables();
  return new Set(tables.map((table) => (typeof table === 'string' ? table : table.tableName)));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const present = await existingTables(queryInterface);

    if (!present.has('market_discovery_runs')) {
      await queryInterface.createTable('market_discovery_runs', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        vertical: { type: Sequelize.STRING(64), allowNull: false },
        discovery_version: { type: Sequelize.STRING(128), allowNull: false },
        state: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'MARKET_DISCOVERY_OPEN' },
        started_at: { type: Sequelize.DATE, allowNull: false },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'market_discovery_runs', ['tenant_key', 'vertical', 'discovery_version'], {
        name: 'market_discovery_runs_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'market_discovery_runs', ['tenant_key', 'vertical'], {
        name: 'market_discovery_runs_tenant_vertical_idx',
      });
    }

    if (!present.has('market_archetypes')) {
      await queryInterface.createTable('market_archetypes', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        vertical: { type: Sequelize.STRING(64), allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: true },
        archetype_key: { type: Sequelize.STRING(128), allowNull: false },
        name: { type: Sequelize.STRING(256), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        importance: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'RELEVANT' },
        state: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'EVIDENCE_REQUIRED' },
        origin: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'research' },
        source_evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        rationale: { type: Sequelize.TEXT, allowNull: true },
        validated_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'market_archetypes', ['tenant_key', 'vertical', 'archetype_key'], {
        name: 'market_archetypes_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'market_archetypes', ['tenant_key', 'vertical'], {
        name: 'market_archetypes_tenant_vertical_idx',
      });
    }

    if (!present.has('market_candidates')) {
      await queryInterface.createTable('market_candidates', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        vertical: { type: Sequelize.STRING(64), allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: true },
        candidate_key: { type: Sequelize.STRING(128), allowNull: false },
        name: { type: Sequelize.STRING(256), allowNull: false },
        vendor: { type: Sequelize.STRING(256), allowNull: true },
        official_site: { type: Sequelize.STRING(2048), allowNull: true },
        official_docs: { type: Sequelize.STRING(2048), allowNull: true },
        api_docs: { type: Sequelize.STRING(2048), allowNull: true },
        country: { type: Sequelize.STRING(8), allowNull: true },
        region: { type: Sequelize.STRING(64), allowNull: true },
        segments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        target_customers: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        archetypes: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        independence_group: { type: Sequelize.STRING(128), allowNull: true },
        clone_of: { type: Sequelize.STRING(128), allowNull: true },
        base_product: { type: Sequelize.STRING(128), allowNull: true },
        origin: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'research' },
        state: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'EVIDENCE_REQUIRED' },
        source_evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        rationale: { type: Sequelize.TEXT, allowNull: true },
        profile: { type: Sequelize.JSONB, allowNull: true },
        profiled_at: { type: Sequelize.DATE, allowNull: true },
        deep_research_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'market_candidates', ['tenant_key', 'vertical', 'candidate_key'], {
        name: 'market_candidates_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'market_candidates', ['tenant_key', 'vertical'], {
        name: 'market_candidates_tenant_vertical_idx',
      });
      await addIndexIfNotExists(queryInterface, 'market_candidates', ['tenant_key', 'vertical', 'state'], {
        name: 'market_candidates_state_idx',
      });
    }

    if (!present.has('market_discovery_sets')) {
      await queryInterface.createTable('market_discovery_sets', {
        id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        vertical: { type: Sequelize.STRING(64), allowNull: false },
        run_id: { type: Sequelize.STRING(64), allowNull: true },
        discovery_set_version: { type: Sequelize.STRING(128), allowNull: false },
        state: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'SELECTED' },
        selected_candidates: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        selection_rationale: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        selection_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        holdout_candidate_id: { type: Sequelize.STRING(128), allowNull: true },
        holdout_selected_at: { type: Sequelize.DATE, allowNull: true },
        holdout_selection_basis: { type: Sequelize.JSONB, allowNull: true },
        holdout_preregistered: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        opened_at: { type: Sequelize.DATE, allowNull: true },
        deep_research_run_id: { type: Sequelize.STRING(64), allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      });
      await addIndexIfNotExists(queryInterface, 'market_discovery_sets', ['tenant_key', 'vertical', 'discovery_set_version'], {
        name: 'market_discovery_sets_identity_uq',
        unique: true,
      });
      await addIndexIfNotExists(queryInterface, 'market_discovery_sets', ['tenant_key', 'vertical'], {
        name: 'market_discovery_sets_tenant_vertical_idx',
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
