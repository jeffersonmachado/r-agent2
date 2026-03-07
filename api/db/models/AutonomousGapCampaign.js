const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('AutonomousGapCampaign', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: true },
  source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'detected_gap' },
  channel: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'whatsapp' },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'open' },
  context_type: { type: DataTypes.STRING(24), allowNull: false },
  context_id: { type: DataTypes.STRING(128), allowNull: false },
  service_type: { type: DataTypes.STRING(120), allowNull: true },
  owner_id: { type: DataTypes.STRING(128), allowNull: true },
  team_id: { type: DataTypes.STRING(128), allowNull: true },
  gap_fingerprint: { type: DataTypes.STRING(64), allowNull: true },
  gap_start_at: { type: DataTypes.DATE, allowNull: false },
  gap_end_at: { type: DataTypes.DATE, allowNull: false },
  timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'UTC' },
  max_invites: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
  sent_invites: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  accepted_contact_id: { type: DataTypes.STRING(128), allowNull: true },
  closed_reason: { type: DataTypes.STRING(64), allowNull: true },
  metadata: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
  started_at: { type: DataTypes.DATE, allowNull: true },
  closed_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'autonomous_gap_campaigns',
  timestamps: true,
  underscored: true,
  hooks: { beforeValidate(instance) { if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}'); } },
  indexes: [
    { fields: ['tenant_key', 'status', 'gap_start_at'], name: 'autonomous_gap_campaigns_tenant_status_gap_idx' },
    { fields: ['tenant_key', 'context_type', 'context_id', 'status'], name: 'autonomous_gap_campaigns_tenant_context_status_idx' },
    { fields: ['tenant_key', 'gap_fingerprint'], name: 'autonomous_gap_campaigns_tenant_fingerprint_uidx', unique: true },
  ],
});
