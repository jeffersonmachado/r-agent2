const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('AutonomousWaitingList', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: false },
  context_type: { type: DataTypes.STRING(24), allowNull: true },
  context_id: { type: DataTypes.STRING(128), allowNull: true },
  desired_channel: { type: DataTypes.STRING(24), allowNull: true },
  service_type: { type: DataTypes.STRING(120), allowNull: true },
  owner_id: { type: DataTypes.STRING(128), allowNull: true },
  team_id: { type: DataTypes.STRING(128), allowNull: true },
  preferred_weekdays: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('preferred_weekdays'), []); },
    set(value) { this.setDataValue('preferred_weekdays', stringifyJsonText(value, [])); },
  },
  preferred_time_windows: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('preferred_time_windows'), []); },
    set(value) { this.setDataValue('preferred_time_windows', stringifyJsonText(value, [])); },
  },
  notes: { type: DataTypes.TEXT, allowNull: true },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  metadata: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'autonomous_waiting_list',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('preferred_weekdays')) instance.setDataValue('preferred_weekdays', '[]');
      if (!instance.getDataValue('preferred_time_windows')) instance.setDataValue('preferred_time_windows', '[]');
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active', 'service_type'], name: 'autonomous_waiting_list_tenant_active_service_idx' },
    { fields: ['tenant_key', 'contact_id', 'active'], name: 'autonomous_waiting_list_tenant_contact_active_idx' },
  ],
});
