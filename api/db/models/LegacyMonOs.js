const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyMonOs', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key', defaultValue: 'system' },
  os: { type: DataTypes.STRING(255), allowNull: false },
}, {
  tableName: 'legacy_mon_os',
  timestamps: true,
});

