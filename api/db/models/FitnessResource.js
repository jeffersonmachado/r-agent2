const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessResource', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  resource_type: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'room' },
  capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  location: { type: DataTypes.STRING(120), allowNull: true },
  exclusive_use: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'fitness_resources',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active'], name: 'fitness_resources_tenant_active_idx' },
    { fields: ['tenant_key', 'resource_type'], name: 'fitness_resources_tenant_type_idx' },
  ],
});
