/**
 * Model MarketArchetype - market_archetypes
 *
 * Arquétipo de mercado DESCOBERTO/REVALIDADO com evidência. Um arquétipo só é
 * ACCEPTED quando carrega `source_evidence` real (URL + referência/hash de
 * evidência); sem evidência o estado é EVIDENCE_REQUIRED ou REJECTED — nunca
 * ACCEPTED por confiança histórica no config.
 *
 * Identidade determinística `(tenant_key, vertical, archetype_key)`: a
 * revalidação ATUALIZA o mesmo registro (idempotente), não cria história nova.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketArchetype = null;

function getMarketArchetypeModel() {
  if (!MarketArchetype) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketArchetype = sequelize.define('MarketArchetype', {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING(64), allowNull: false },
      run_id: { type: DataTypes.STRING(64), allowNull: true },
      archetype_key: { type: DataTypes.STRING(128), allowNull: false },
      name: { type: DataTypes.STRING(256), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      importance: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'RELEVANT' },
      state: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'EVIDENCE_REQUIRED' },
      origin: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'research' },
      source_evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      rationale: { type: DataTypes.TEXT, allowNull: true },
      validated_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_archetypes',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'archetype_key'], name: 'market_archetypes_identity_uq', unique: true },
        { fields: ['tenant_key', 'vertical'], name: 'market_archetypes_tenant_vertical_idx' },
      ],
    });
  }
  return MarketArchetype;
}

module.exports = getMarketArchetypeModel;
