/**
 * Model TenantRecommendation - tenant_recommendations (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantRecommendation = null;

function getTenantRecommendationModel() {
  if (!TenantRecommendation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantRecommendation = sequelize.define('TenantRecommendation', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      insight_id: { type: DataTypes.STRING, allowNull: true },
      goal_id: { type: DataTypes.STRING, allowNull: true },
      title: { type: DataTypes.STRING(220), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      action_type: { type: DataTypes.STRING(80), allowNull: false },
      priority: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'open' },
      estimated_impact: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'tenant_recommendations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_recommendations_tenant_key_idx' },
        { fields: ['tenant_key', 'status'], name: 'tenant_recommendations_tenant_status_idx' },
        { fields: ['tenant_key', 'insight_id'], name: 'tenant_recommendations_tenant_insight_idx' },
        { fields: ['tenant_key', 'goal_id'], name: 'tenant_recommendations_tenant_goal_idx' },
      ],
    });
  }

  return TenantRecommendation;
}

module.exports = getTenantRecommendationModel;
