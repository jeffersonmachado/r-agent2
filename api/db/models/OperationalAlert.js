const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('OperationalAlert', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  alert_type: { type: DataTypes.STRING(80), allowNull: false },
  severity: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
  entity_type: { type: DataTypes.STRING(80), allowNull: false },
  entity_id: { type: DataTypes.STRING(191), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: false },
  resolved_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'operational_alerts',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'created_at'], name: 'oper_alerts_tenant_created_idx' },
    { fields: ['tenant_key', 'resolved_at'], name: 'oper_alerts_tenant_resolved_idx' },
    { fields: ['tenant_key', 'alert_type', 'entity_type', 'entity_id'], name: 'oper_alerts_tenant_type_entity_idx' },
  ],
});
