const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ScheduleWorkingHour', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  scope_type: { type: DataTypes.STRING(16), allowNull: false }, // team|owner
  scope_id: { type: DataTypes.STRING(128), allowNull: false },
  weekday: { type: DataTypes.INTEGER, allowNull: false },
  start_time: { type: DataTypes.STRING(5), allowNull: false },
  end_time: { type: DataTypes.STRING(5), allowNull: false },
  timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'UTC' },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
  tableName: 'schedule_working_hours',
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
    {
      fields: ['tenant_key', 'scope_type', 'scope_id', 'weekday', 'enabled'],
      name: 'schedule_working_hours_tenant_scope_weekday_enabled_idx',
    },
  ],
});
