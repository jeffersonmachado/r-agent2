const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessActivityResource', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  activity_id: { type: DataTypes.STRING(128), allowNull: false },
  resource_id: { type: DataTypes.STRING(128), allowNull: false },
  required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  exclusive_use: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'fitness_activity_resources',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'activity_id', 'resource_id'], name: 'fitness_activity_resources_tenant_activity_res_uidx', unique: true },
    { fields: ['tenant_key', 'resource_id'], name: 'fitness_activity_resources_tenant_res_idx' },
  ],
});
