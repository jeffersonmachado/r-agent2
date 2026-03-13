const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxBlockRule', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  direction: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'outbound' },
  pattern: { type: DataTypes.STRING(128), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  reason: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: 'pbx_block_rules',
  timestamps: true,
});

