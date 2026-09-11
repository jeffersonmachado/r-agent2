'use strict';

/**
 * Integration Hub (R-Bridge) — camada mínima provider-neutral de integração.
 *
 * Cria 4 tabelas:
 * - integration_connections:    conexão tenant ↔ provider (credencial cifrada)
 * - integration_object_links:   external_id ↔ recurso interno canônico
 * - integration_sync_states:    cursor/watermark por conexão+recurso
 * - integration_inbound_events: eventos externos deduplicados (webhook como sinal)
 *
 * Nenhum id externo é PK interna. Nenhum segredo em texto claro.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'integration_connections', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      label: { type: Sequelize.STRING(160), allowNull: true },
      external_unit_id: { type: Sequelize.STRING(160), allowNull: true },
      unit_label: { type: Sequelize.STRING(160), allowNull: true },
      opaque_key: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'disconnected' },
      config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      credentials_encrypted: { type: Sequelize.TEXT, allowNull: true },
      credential_hint: { type: Sequelize.STRING(64), allowNull: true },
      last_sync_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'integration_connections', ['tenant_key', 'provider'], {
      name: 'integration_connections_tenant_provider_idx',
    });
    await addIndexIfNotExists(queryInterface, 'integration_connections', ['opaque_key'], {
      name: 'integration_connections_opaque_key_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'integration_object_links', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      connection_id: { type: Sequelize.STRING, allowNull: false },
      resource_type: { type: Sequelize.STRING(64), allowNull: false },
      external_id: { type: Sequelize.STRING(255), allowNull: false },
      internal_type: { type: Sequelize.STRING(64), allowNull: false },
      internal_id: { type: Sequelize.STRING(255), allowNull: false },
      sync_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      last_seen_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(
      queryInterface,
      'integration_object_links',
      ['tenant_key', 'provider', 'connection_id', 'resource_type', 'external_id'],
      { name: 'integration_object_links_external_uq', unique: true },
    );
    await addIndexIfNotExists(queryInterface, 'integration_object_links', ['tenant_key', 'internal_type', 'internal_id'], {
      name: 'integration_object_links_internal_idx',
    });

    await createTableIfNotExists(queryInterface, 'integration_sync_states', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      connection_id: { type: Sequelize.STRING, allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      resource_type: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'idle' },
      watermark_at: { type: Sequelize.DATE, allowNull: true },
      overlap_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3600 },
      cursor: { type: Sequelize.STRING(512), allowNull: true },
      page_offset: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      initial_sync_completed_at: { type: Sequelize.DATE, allowNull: true },
      last_run_at: { type: Sequelize.DATE, allowNull: true },
      last_success_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      stats: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'integration_sync_states', ['tenant_key', 'connection_id', 'resource_type'], {
      name: 'integration_sync_states_scope_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'integration_sync_states', ['tenant_key', 'status'], {
      name: 'integration_sync_states_tenant_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'integration_inbound_events', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      connection_id: { type: Sequelize.STRING, allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      event_type: { type: Sequelize.STRING(96), allowNull: false },
      external_event_id: { type: Sequelize.STRING(255), allowNull: true },
      resource_type: { type: Sequelize.STRING(64), allowNull: true },
      external_resource_id: { type: Sequelize.STRING(255), allowNull: true },
      idempotency_key: { type: Sequelize.STRING(255), allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      received_at: { type: Sequelize.DATE, allowNull: false },
      processed_at: { type: Sequelize.DATE, allowNull: true },
      processing_state: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'received' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      error: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'integration_inbound_events', ['tenant_key', 'provider', 'idempotency_key'], {
      name: 'integration_inbound_events_idempotency_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'integration_inbound_events', ['tenant_key', 'processing_state'], {
      name: 'integration_inbound_events_state_idx',
    });
    await addIndexIfNotExists(queryInterface, 'integration_inbound_events', ['tenant_key', 'connection_id', 'received_at'], {
      name: 'integration_inbound_events_connection_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('integration_inbound_events').catch(() => {});
    await queryInterface.dropTable('integration_sync_states').catch(() => {});
    await queryInterface.dropTable('integration_object_links').catch(() => {});
    await queryInterface.dropTable('integration_connections').catch(() => {});
  },
};
