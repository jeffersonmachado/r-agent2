const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessClassSchedule', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  class_id: { type: DataTypes.STRING(128), allowNull: false },
  start_at: { type: DataTypes.DATE, allowNull: false },
  end_at: { type: DataTypes.DATE, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  location: { type: DataTypes.STRING(120), allowNull: true },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'scheduled' },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: true },
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
  tableName: 'fitness_class_schedules',
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
    { fields: ['tenant_key', 'class_id', 'start_at'], name: 'fitness_class_schedules_tenant_class_start_idx' },
    { fields: ['tenant_key', 'status', 'start_at'], name: 'fitness_class_schedules_tenant_status_start_idx' },
  ],
});
