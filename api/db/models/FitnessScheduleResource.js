const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessScheduleResource', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  class_schedule_id: { type: DataTypes.STRING(128), allowNull: false },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: true },
  resource_id: { type: DataTypes.STRING(128), allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  exclusive_use: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() {
      return parseJsonText(this.getDataValue('metadata'), {});
    },
    set(value) {
      this.setDataValue('metadata', stringifyJsonText(value, {}));
    },
  },
}, {
  tableName: 'fitness_schedule_resources',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      const raw = instance.getDataValue('metadata');
      if (raw === null || raw === undefined || raw === '') {
        instance.setDataValue('metadata', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'class_schedule_id', 'resource_id'], name: 'fitness_schedule_res_tenant_sched_res_uidx', unique: true },
    { fields: ['tenant_key', 'resource_id'], name: 'fitness_schedule_res_tenant_res_idx' },
    { fields: ['tenant_key', 'operational_schedule_id'], name: 'fitness_schedule_res_tenant_operational_idx' },
  ],
});
