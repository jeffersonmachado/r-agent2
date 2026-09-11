'use strict';

/**
 * IntegrationConnection — conexão de um tenant com um provedor externo.
 *
 * Provider-neutral: o domínio RAP nunca conhece formato bruto do provedor; ele
 * fala com `IntegrationConnection` + adapter do provider.
 *
 * Regras:
 * - SEMPRE escopada por `tenant_key` (isolamento multi-tenant por query).
 * - `opaque_key` é a identidade pública da conexão usada em URL de webhook
 *   (nunca o tenant id, nunca sequencial/advinnhável).
 * - `config` guarda somente dados NÃO secretos (baseUrl, unit label, flags).
 * - `credentials_encrypted` guarda o segredo cifrado com `api/utils/crypto`
 *   (AES-256-GCM). Nunca é devolvido por API/log/erro.
 * - `external_unit_id` é a unidade externa do provedor. Hoje o cliente tem UMA
 *   unidade; a coluna existe para não exigir reescrita quando houver várias.
 */

const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('IntegrationConnection', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  provider: { type: DataTypes.STRING(64), allowNull: false },
  label: { type: DataTypes.STRING(160), allowNull: true },
  external_unit_id: { type: DataTypes.STRING(160), allowNull: true },
  unit_label: { type: DataTypes.STRING(160), allowNull: true },
  opaque_key: { type: DataTypes.STRING(64), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'disconnected' },
  config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  credentials_encrypted: { type: DataTypes.TEXT, allowNull: true },
  credential_hint: { type: DataTypes.STRING(64), allowNull: true },
  last_sync_at: { type: DataTypes.DATE, allowNull: true },
  last_error: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'integration_connections',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'provider'], name: 'integration_connections_tenant_provider_idx' },
    { fields: ['opaque_key'], unique: true, name: 'integration_connections_opaque_key_uq' },
  ],
});
