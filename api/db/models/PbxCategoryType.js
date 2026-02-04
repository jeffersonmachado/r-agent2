const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxCategoryType', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  code: { type: DataTypes.STRING(40), allowNull: false },
  name: { type: DataTypes.STRING(128), allowNull: false },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_category_types',
  timestamps: true,
});

