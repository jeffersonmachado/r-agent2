const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxConfigVersion', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  version: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'draft' },
  summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdByUserId: { type: DataTypes.STRING, allowNull: true, field: 'created_by_user_id' },
}, {
  tableName: 'pbx_config_versions',
  timestamps: true,
});

