/**
 * Model TenantGoal - tenant_goals (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantGoal = null;

function getTenantGoalModel() {
  if (!TenantGoal) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantGoal = sequelize.define('TenantGoal', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING(180), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      metric_key: { type: DataTypes.STRING(120), allowNull: false },
      target_value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      current_value: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
      comparison_mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'gte' },
      period_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'month' },
      start_date: { type: DataTypes.DATEONLY, allowNull: true },
      end_date: { type: DataTypes.DATEONLY, allowNull: true },
      priority: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'active' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'tenant_goals',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_goals_tenant_key_idx' },
        { fields: ['tenant_key', 'status'], name: 'tenant_goals_tenant_status_idx' },
        { fields: ['tenant_key', 'period_type'], name: 'tenant_goals_tenant_period_type_idx' },
      ],
    });
  }

  return TenantGoal;
}

module.exports = getTenantGoalModel;
