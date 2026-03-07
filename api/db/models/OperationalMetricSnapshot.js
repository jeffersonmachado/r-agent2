const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalMetricSnapshot', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  metric_scope: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'autonomous' },
  vertical_template: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'beauty' },
  service_type: { type: DataTypes.STRING(100), allowNull: true },
  owner_id: { type: DataTypes.STRING(128), allowNull: true },
  team_id: { type: DataTypes.STRING(128), allowNull: true },
  day_of_week: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  hour_bucket: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  snapshot_date: { type: DataTypes.DATEONLY, allowNull: false },
  open_campaigns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  filled_campaigns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  accepted_candidates: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expired_campaigns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  fill_rate: { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
  accept_rate: { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
  avg_fill_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  idle_risk_score: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
  no_show_risk_score: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
  snapshot_payload_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('snapshot_payload_json'), null); },
    set(value) { this.setDataValue('snapshot_payload_json', value == null ? null : stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'operational_metric_snapshots',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'snapshot_date'], name: 'oper_metric_snapshots_tenant_date_idx' },
    { fields: ['tenant_key', 'metric_scope', 'snapshot_date'], name: 'oper_metric_snapshots_tenant_scope_date_idx' },
    { fields: ['tenant_key', 'vertical_template', 'service_type'], name: 'oper_metric_snapshots_tenant_vertical_service_idx' },
    { fields: ['tenant_key', 'snapshot_date', 'vertical_template', 'service_type', 'owner_id', 'team_id', 'day_of_week', 'hour_bucket'], name: 'oper_metric_snapshots_dedupe_idx', unique: true },
  ],
});
