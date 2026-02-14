const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxTrunk', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(128), allowNull: false },
  type: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'pjsip' },
  transport: { type: DataTypes.STRING(40), allowNull: true },
  auth: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  aor: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  endpoint: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'active' },
}, {
  tableName: 'pbx_trunks',
  timestamps: true,
});

