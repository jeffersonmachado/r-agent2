/**
 * Model TenantInsight - tenant_insights (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantInsight = null;

function getTenantInsightModel() {
  if (!TenantInsight) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantInsight = sequelize.define('TenantInsight', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING(80), allowNull: false },
      title: { type: DataTypes.STRING(220), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      confidence: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      impact: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'open' },
      period_start: { type: DataTypes.DATE, allowNull: true },
      period_end: { type: DataTypes.DATE, allowNull: true },
      source: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'tenant_intelligence' },
      related_metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'tenant_insights',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_insights_tenant_key_idx' },
        { fields: ['tenant_key', 'status'], name: 'tenant_insights_tenant_status_idx' },
        { fields: ['tenant_key', 'period_start', 'period_end'], name: 'tenant_insights_tenant_period_idx' },
      ],
    });
  }

  return TenantInsight;
}

module.exports = getTenantInsightModel;
