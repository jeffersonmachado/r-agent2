const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxRoute', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  direction: { type: DataTypes.STRING(16), allowNull: false }, // inbound|outbound
  name: { type: DataTypes.STRING(128), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  match: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  actions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
}, {
  tableName: 'pbx_routes',
  timestamps: true,
});

