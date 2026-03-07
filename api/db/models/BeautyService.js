const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('BeautyService', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  category: { type: DataTypes.STRING(80), allowNull: true },
  default_duration: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  default_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'beauty_services',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active'], name: 'beauty_services_tenant_active_idx' },
    { fields: ['tenant_key', 'category'], name: 'beauty_services_tenant_category_idx' },
  ],
});
