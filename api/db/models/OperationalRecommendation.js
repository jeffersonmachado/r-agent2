const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalRecommendation', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  contact_id: { type: DataTypes.STRING(191), allowNull: true },
  recommendation_type: { type: DataTypes.STRING(120), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
  confidence: { type: DataTypes.DECIMAL(7, 4), allowNull: false, defaultValue: 0.5 },
  impact_level: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
  target_module: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'support' },
  description: { type: DataTypes.TEXT, allowNull: false },
  suggested_actions_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('suggested_actions_json'), []); },
    set(value) { this.setDataValue('suggested_actions_json', value == null ? null : stringifyJsonText(value, [])); },
  },
  context_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('context_json'), {}); },
    set(value) { this.setDataValue('context_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  source_signal_id: { type: DataTypes.STRING(191), allowNull: true },
  source_signal_type: { type: DataTypes.STRING(120), allowNull: true },
  resolved_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'operational_recommendations',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status', 'priority', 'updated_at'], name: 'oper_recs_tenant_status_priority_updated_idx' },
    { fields: ['tenant_key', 'contact_id', 'status', 'priority'], name: 'oper_recs_tenant_contact_status_priority_idx' },
    { fields: ['tenant_key', 'source_signal_id', 'recommendation_type'], name: 'oper_recs_tenant_source_signal_type_idx' },
  ],
});
