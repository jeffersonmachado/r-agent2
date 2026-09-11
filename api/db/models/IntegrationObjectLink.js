'use strict';

/**
 * IntegrationObjectLink — mapeamento determinístico entre um objeto externo
 * (provider/connection/resource_type/external_id) e um recurso interno do RAP.
 *
 * Invariante central: o id externo NUNCA é a PK interna. `internal_id` aponta
 * para o recurso canônico (MarketingLead, AccessSubject, AccessMembership,
 * VerticalAttendance, BillingTransaction...).
 *
 * A chave de sincronização é (tenant_key, provider, connection_id,
 * resource_type, external_id) — nunca CPF/e-mail/telefone/nome.
 */

const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('IntegrationObjectLink', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  provider: { type: DataTypes.STRING(64), allowNull: false },
  connection_id: { type: DataTypes.STRING, allowNull: false },
  resource_type: { type: DataTypes.STRING(64), allowNull: false },
  external_id: { type: DataTypes.STRING(255), allowNull: false },
  internal_type: { type: DataTypes.STRING(64), allowNull: false },
  internal_id: { type: DataTypes.STRING(255), allowNull: false },
  sync_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  last_seen_at: { type: DataTypes.DATE, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'integration_object_links',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['tenant_key', 'provider', 'connection_id', 'resource_type', 'external_id'],
      unique: true,
      name: 'integration_object_links_external_uq',
    },
    { fields: ['tenant_key', 'internal_type', 'internal_id'], name: 'integration_object_links_internal_idx' },
  ],
});
