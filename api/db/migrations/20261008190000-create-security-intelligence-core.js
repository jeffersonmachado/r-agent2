'use strict';

/**
 * Migration: núcleo de persistência da capacidade RAP Version & Security
 * Intelligence (inventário de componentes, versões observadas, execuções de
 * descoberta e snapshots de SBOM).
 *
 * Decisões registradas (e o porquê):
 *   - O estado AUTORITATIVO é o Postgres. JSON/artefato é apenas export/evidência
 *     (ver `governance/json-persistence-audit.js`).
 *   - Quatro tabelas, não uma: identidade corrente do componente
 *     (`security_components`) é separada do HISTÓRICO de versões observadas
 *     (`security_component_versions`, append-only por observação) para que uma
 *     mudança de versão seja um evento auditável e não uma sobrescrita silenciosa.
 *   - A execução da descoberta (`security_discovery_runs`) guarda a COBERTURA e as
 *     indisponibilidades junto com o resultado: sem isso, "não achei" ficaria
 *     indistinguível de "não olhei".
 *   - `tenant_key` com default `system`: o inventário é da plataforma, mas a
 *     segregação por tenant precisa existir desde o schema (multi-tenant).
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'security_discovery_runs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PASS' },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      counts: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      coverage: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      sources: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      unavailable: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      drift: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      warnings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      identity_conflicts: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      engine_version: { type: Sequelize.STRING, allowNull: false, defaultValue: 'unknown' },
      actor: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_discovery_runs', ['tenant_key', 'started_at'], {
      name: 'security_discovery_runs_tenant_started_idx',
    });
    await addIndexIfNotExists(queryInterface, 'security_discovery_runs', ['idempotency_key'], {
      unique: true,
      name: 'security_discovery_runs_idempotency_key_unique',
    });

    await createTableIfNotExists(queryInterface, 'security_components', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      bom_ref: { type: Sequelize.STRING, allowNull: false },
      ecosystem: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      namespace: { type: Sequelize.STRING, allowNull: true },
      version: { type: Sequelize.STRING, allowNull: true },
      version_class: { type: Sequelize.STRING, allowNull: false, defaultValue: 'RESOLVED' },
      purl: { type: Sequelize.STRING, allowNull: true },
      kind: { type: Sequelize.STRING, allowNull: true },
      service: { type: Sequelize.STRING, allowNull: true },
      source: { type: Sequelize.STRING, allowNull: true },
      sources: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      install_path: { type: Sequelize.STRING, allowNull: true },
      direct: { type: Sequelize.BOOLEAN, allowNull: true },
      dev: { type: Sequelize.BOOLEAN, allowNull: true },
      optional: { type: Sequelize.BOOLEAN, allowNull: true },
      built_locally: { type: Sequelize.BOOLEAN, allowNull: true },
      pinned_by_digest: { type: Sequelize.BOOLEAN, allowNull: true },
      fingerprint: { type: Sequelize.STRING, allowNull: false },
      integrity: { type: Sequelize.STRING, allowNull: true },
      license_name: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      first_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_run_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_components', ['tenant_key', 'bom_ref'], {
      unique: true,
      name: 'security_components_tenant_bom_ref_unique',
    });
    await addIndexIfNotExists(queryInterface, 'security_components', ['tenant_key', 'ecosystem', 'name'], {
      name: 'security_components_lookup_idx',
    });
    await addIndexIfNotExists(queryInterface, 'security_components', ['service'], {
      name: 'security_components_service_idx',
    });

    await createTableIfNotExists(queryInterface, 'security_component_versions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      component_id: { type: Sequelize.UUID, allowNull: false },
      bom_ref: { type: Sequelize.STRING, allowNull: false },
      version: { type: Sequelize.STRING, allowNull: true },
      version_class: { type: Sequelize.STRING, allowNull: false },
      source: { type: Sequelize.STRING, allowNull: true },
      evidence_origin: { type: Sequelize.STRING, allowNull: true },
      integrity: { type: Sequelize.STRING, allowNull: true },
      fingerprint: { type: Sequelize.STRING, allowNull: false },
      observed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      run_id: { type: Sequelize.UUID, allowNull: true },
      drift: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_component_versions', ['component_id', 'observed_at'], {
      name: 'security_component_versions_component_observed_idx',
    });
    await addIndexIfNotExists(
      queryInterface,
      'security_component_versions',
      ['component_id', 'version', 'version_class', 'fingerprint'],
      { unique: true, name: 'security_component_versions_observation_unique' }
    );

    await createTableIfNotExists(queryInterface, 'security_sbom_snapshots', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      serial_number: { type: Sequelize.STRING, allowNull: false },
      sbom_format: { type: Sequelize.STRING, allowNull: false, defaultValue: 'CycloneDX' },
      spec_version: { type: Sequelize.STRING, allowNull: false, defaultValue: '1.5' },
      sha256: { type: Sequelize.STRING, allowNull: false },
      component_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      root_name: { type: Sequelize.STRING, allowNull: false },
      root_version: { type: Sequelize.STRING, allowNull: true },
      generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      run_id: { type: Sequelize.UUID, allowNull: true },
      validation: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      artifact_ref: { type: Sequelize.STRING, allowNull: true },
      sbom: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_sbom_snapshots', ['tenant_key', 'sha256'], {
      unique: true,
      name: 'security_sbom_snapshots_tenant_sha_unique',
    });
    await addIndexIfNotExists(queryInterface, 'security_sbom_snapshots', ['generated_at'], {
      name: 'security_sbom_snapshots_generated_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('security_sbom_snapshots').catch(() => {});
    await queryInterface.dropTable('security_component_versions').catch(() => {});
    await queryInterface.dropTable('security_components').catch(() => {});
    await queryInterface.dropTable('security_discovery_runs').catch(() => {});
  },
};
