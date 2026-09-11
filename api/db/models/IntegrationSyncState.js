'use strict';

/**
 * IntegrationSyncState — cursor/watermark de sincronização por conexão e
 * recurso. Permite initial sync, incremental sync, retomada após falha,
 * overlap controlado, reprocessamento idempotente e reconciliação.
 *
 * Um registro por (tenant_key, connection_id, resource_type).
 */

const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('IntegrationSyncState', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  connection_id: { type: DataTypes.STRING, allowNull: false },
  provider: { type: DataTypes.STRING(64), allowNull: false },
  resource_type: { type: DataTypes.STRING(64), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'idle' },
  watermark_at: { type: DataTypes.DATE, allowNull: true },
  overlap_seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3600 },
  cursor: { type: DataTypes.STRING(512), allowNull: true },
  page_offset: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  initial_sync_completed_at: { type: DataTypes.DATE, allowNull: true },
  last_run_at: { type: DataTypes.DATE, allowNull: true },
  last_success_at: { type: DataTypes.DATE, allowNull: true },
  last_error: { type: DataTypes.TEXT, allowNull: true },
  stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'integration_sync_states',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['tenant_key', 'connection_id', 'resource_type'],
      unique: true,
      name: 'integration_sync_states_scope_uq',
    },
    { fields: ['tenant_key', 'status'], name: 'integration_sync_states_tenant_status_idx' },
  ],
});
