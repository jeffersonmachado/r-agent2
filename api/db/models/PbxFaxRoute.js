const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxFaxRoute', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(128), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  definition: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_fax_routes',
  timestamps: true,
});

