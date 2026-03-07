const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ScheduleReminder', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  schedule_id: { type: DataTypes.STRING, allowNull: false },
  offset_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  action: { type: DataTypes.STRING(40), allowNull: false }, // notify|request_confirmation|mark_no_show
  channel: { type: DataTypes.STRING(24), allowNull: true },
  execute_at: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
  payload: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() {
      return parseJsonText(this.getDataValue('payload'), {});
    },
    set(value) {
      this.setDataValue('payload', stringifyJsonText(value, {}));
    },
  },
  last_error: { type: DataTypes.TEXT, allowNull: true },
  processing_started_at: { type: DataTypes.DATE, allowNull: true },
  executed_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'schedule_reminders',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      const raw = instance.getDataValue('payload');
      if (raw === null || raw === undefined || raw === '') {
        instance.setDataValue('payload', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'execute_at', 'status'], name: 'schedule_reminders_tenant_execute_status_idx' },
    { fields: ['schedule_id', 'offset_minutes', 'action'], name: 'schedule_reminders_schedule_offset_action_idx' },
  ],
});
