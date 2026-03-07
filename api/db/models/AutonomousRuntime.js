const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('AutonomousRuntime', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  auto_detect_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  auto_campaign_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  auto_expire_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  run_interval_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  max_campaigns_per_run: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  max_invites_per_run: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
  quiet_hours_start: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '22:00' },
  quiet_hours_end: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '07:00' },
  predictive_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  revenue_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  kiosk_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  snapshot_generation_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  recommendations_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  simulation_mode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  max_recommendations_per_run: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  max_snapshots_per_day: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
  runtime_notes: { type: DataTypes.TEXT, allowNull: true },
  enabled_channels_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('enabled_channels_json'), ['whatsapp']); },
    set(value) { this.setDataValue('enabled_channels_json', stringifyJsonText(value, ['whatsapp'])); },
  },
  safety_mode: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'manual' },
}, {
  tableName: 'autonomous_runtime',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('enabled_channels_json')) {
        instance.setDataValue('enabled_channels_json', '["whatsapp"]');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key'], name: 'autonomous_runtime_tenant_uidx', unique: true },
  ],
});
