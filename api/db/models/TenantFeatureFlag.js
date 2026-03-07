const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('TenantFeatureFlag', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  feature_key: { type: DataTypes.STRING(120), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  config_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('config_json'), {}); },
    set(value) { this.setDataValue('config_json', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'tenant_feature_flags',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('config_json')) {
        instance.setDataValue('config_json', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'feature_key'], name: 'tenant_feature_flags_tenant_feature_uidx', unique: true },
    { fields: ['tenant_key', 'enabled'], name: 'tenant_feature_flags_tenant_enabled_idx' },
  ],
});
