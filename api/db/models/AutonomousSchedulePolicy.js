const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('AutonomousSchedulePolicy', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  channel: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'whatsapp' },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  auto_fill_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  waiting_list_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  reactivation_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  min_notice_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  fill_horizon_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 48 },
  max_invites_per_campaign: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
  max_invites_per_contact_day: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
  max_invites_per_contact_week: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
  cooldown_hours_after_reject: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 48 },
  cooldown_hours_after_no_response: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 24 },
  min_gap_duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  send_window_start: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '08:00' },
  send_window_end: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '19:00' },
  allowed_weekdays: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('allowed_weekdays'), [0,1,2,3,4,5,6]); },
    set(value) { this.setDataValue('allowed_weekdays', stringifyJsonText(value, [0,1,2,3,4,5,6])); },
  },
  settings: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('settings'), {}); },
    set(value) { this.setDataValue('settings', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'autonomous_schedule_policies',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('allowed_weekdays')) instance.setDataValue('allowed_weekdays', '[0,1,2,3,4,5,6]');
      if (!instance.getDataValue('settings')) instance.setDataValue('settings', '{}');
    },
  },
  indexes: [{ fields: ['tenant_key', 'enabled'], name: 'autonomous_schedule_policies_tenant_enabled_idx' }],
});
