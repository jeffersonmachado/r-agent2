'use strict';

/**
 * IntegrationInboundEvent — evento externo persistido para processamento
 * confiável (webhook como SINAL, não como estado completo).
 *
 * Garantias:
 * - dedup determinístico por (tenant_key, provider, idempotency_key);
 * - `payload` sanitizado (sem Authorization, sem PAN, sem biometria);
 * - `error` sanitizado (sem segredo);
 * - NENHUM segredo é persistido.
 *
 * O tenant NUNCA vem do payload/query: o registro é criado a partir da
 * conexão resolvida server-side pelo `opaque_key` da URL.
 */

const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('IntegrationInboundEvent', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  connection_id: { type: DataTypes.STRING, allowNull: false },
  provider: { type: DataTypes.STRING(64), allowNull: false },
  event_type: { type: DataTypes.STRING(96), allowNull: false },
  external_event_id: { type: DataTypes.STRING(255), allowNull: true },
  resource_type: { type: DataTypes.STRING(64), allowNull: true },
  external_resource_id: { type: DataTypes.STRING(255), allowNull: true },
  idempotency_key: { type: DataTypes.STRING(255), allowNull: false },
  payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  received_at: { type: DataTypes.DATE, allowNull: false },
  processed_at: { type: DataTypes.DATE, allowNull: true },
  processing_state: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'received' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  error: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'integration_inbound_events',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['tenant_key', 'provider', 'idempotency_key'],
      unique: true,
      name: 'integration_inbound_events_idempotency_uq',
    },
    { fields: ['tenant_key', 'processing_state'], name: 'integration_inbound_events_state_idx' },
    { fields: ['tenant_key', 'connection_id', 'received_at'], name: 'integration_inbound_events_connection_idx' },
  ],
});
