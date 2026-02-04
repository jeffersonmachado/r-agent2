const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxDid', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  did: { type: DataTypes.STRING(64), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  match: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  actions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
}, {
  tableName: 'pbx_dids',
  timestamps: true,
});

