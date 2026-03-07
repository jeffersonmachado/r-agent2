const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('BeautyServiceComposition', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  parent_service_id: { type: DataTypes.STRING(128), allowNull: false },
  child_service_id: { type: DataTypes.STRING(128), allowNull: false },
  sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  optional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'beauty_service_compositions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'parent_service_id', 'sequence'], name: 'beauty_service_compositions_tenant_parent_seq_idx' },
    { fields: ['tenant_key', 'parent_service_id', 'child_service_id'], name: 'beauty_service_compositions_tenant_parent_child_idx', unique: true },
  ],
});
