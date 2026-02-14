const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyMonService', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key', defaultValue: 'system' },
  name: { type: DataTypes.STRING(255), allowNull: false },
  host: { type: DataTypes.STRING(255), allowNull: true },
  oid: { type: DataTypes.STRING(255), allowNull: true },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'legacy_mon_services',
  timestamps: true,
});

