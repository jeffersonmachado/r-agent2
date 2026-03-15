/**
 * Model TenantInsightEvidence - tenant_insight_evidences (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantInsightEvidence = null;

function getTenantInsightEvidenceModel() {
  if (!TenantInsightEvidence) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantInsightEvidence = sequelize.define('TenantInsightEvidence', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      insight_id: { type: DataTypes.STRING, allowNull: false },
      evidence_type: { type: DataTypes.STRING(80), allowNull: false },
      source_type: { type: DataTypes.STRING(80), allowNull: false },
      source_id: { type: DataTypes.STRING, allowNull: true },
      excerpt: { type: DataTypes.TEXT, allowNull: true },
      structured_data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'tenant_insight_evidences',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_insight_evidences_tenant_key_idx' },
        { fields: ['tenant_key', 'insight_id'], name: 'tenant_insight_evidences_tenant_insight_idx' },
        { fields: ['tenant_key', 'source_type', 'source_id'], name: 'tenant_insight_evidences_tenant_source_idx' },
      ],
    });
  }

  return TenantInsightEvidence;
}

module.exports = getTenantInsightEvidenceModel;
