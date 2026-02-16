const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxAcl', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(128), allowNull: false },
  description: { type: DataTypes.STRING(255), allowNull: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  deny: { type: DataTypes.TEXT, allowNull: true },
  permit: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'pbx_acls',
  timestamps: true,
});

