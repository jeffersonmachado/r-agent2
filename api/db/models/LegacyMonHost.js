const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyMonHost', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key', defaultValue: 'system' },
  host: { type: DataTypes.STRING(255), allowNull: false },
  displayName: { type: DataTypes.STRING(255), allowNull: true, field: 'display_name' },
  ipv4: { type: DataTypes.STRING(64), allowNull: true },
  ipv6: { type: DataTypes.STRING(64), allowNull: true },
  os: { type: DataTypes.STRING(128), allowNull: true },
  app: { type: DataTypes.STRING(128), allowNull: true },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active' },
}, {
  tableName: 'legacy_mon_hosts',
  timestamps: true,
});

