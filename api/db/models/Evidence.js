const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Evidence = null;

function getEvidenceModel() {
  if (!Evidence) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    Evidence = sequelize.define('Evidence', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      entity_type: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.STRING, allowNull: false },
      related_entities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      source_type: { type: DataTypes.STRING, allowNull: false },
      source_id: { type: DataTypes.STRING, allowNull: false },
      source_ref: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      category: { type: DataTypes.STRING, allowNull: false, defaultValue: 'support' },
      type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'confirmation' },
      theme: { type: DataTypes.STRING, allowNull: true },
      summary: { type: DataTypes.STRING, allowNull: false },
      excerpt: { type: DataTypes.TEXT, allowNull: true },
      normalized_text: { type: DataTypes.TEXT, allowNull: true },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      indexed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      confidence: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.5 },
      strength: { type: DataTypes.STRING, allowNull: false, defaultValue: 'moderate' },
      actor_type: { type: DataTypes.STRING, allowNull: true },
      actor_id: { type: DataTypes.STRING, allowNull: true },
      attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'evidence',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'entity_type', 'entity_id', 'occurred_at'], name: 'evidence_tenant_entity_occurred_idx' },
        { fields: ['tenant_key', 'category', 'occurred_at'], name: 'evidence_tenant_category_occurred_idx' },
        { fields: ['tenant_key', 'type', 'occurred_at'], name: 'evidence_tenant_type_occurred_idx' },
        { fields: ['tenant_key', 'theme', 'occurred_at'], name: 'evidence_tenant_theme_occurred_idx' },
        { fields: ['tenant_key', 'source_type', 'source_id'], name: 'evidence_tenant_source_idx' },
        { fields: ['tenant_key', 'occurred_at'], name: 'evidence_tenant_occurred_idx' },
        { fields: ['tenant_key', 'idempotency_key'], name: 'evidence_tenant_idempotency_idx', unique: true },
      ],
    });
  }

  return Evidence;
}

module.exports = getEvidenceModel;
