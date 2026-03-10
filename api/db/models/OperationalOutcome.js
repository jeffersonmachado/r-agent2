const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalOutcome', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  contact_id: { type: DataTypes.STRING(191), allowNull: true },
  signal_id: { type: DataTypes.STRING(191), allowNull: true },
  recommendation_id: { type: DataTypes.STRING(191), allowNull: true },
  action_id: { type: DataTypes.STRING(191), allowNull: true },
  action_type: { type: DataTypes.STRING(120), allowNull: true },
  playbook_execution_id: { type: DataTypes.STRING(191), allowNull: true },
  source_type: { type: DataTypes.STRING(30), allowNull: false },
  source_id: { type: DataTypes.STRING(191), allowNull: false },
  outcome_type: { type: DataTypes.STRING(120), allowNull: false },
  outcome_score: { type: DataTypes.FLOAT, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'success' },
  result_context_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('result_context_json'), {}); },
    set(value) { this.setDataValue('result_context_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  details_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('details_json'), {}); },
    set(value) { this.setDataValue('details_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  produced_at: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'operational_outcomes',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status', 'produced_at'], name: 'oper_outcomes_tenant_status_produced_idx' },
    { fields: ['tenant_key', 'source_type', 'source_id'], name: 'oper_outcomes_tenant_source_idx' },
    { fields: ['tenant_key', 'action_id', 'produced_at'], name: 'oper_outcomes_tenant_action_idx' },
    { fields: ['tenant_key', 'contact_id', 'produced_at'], name: 'oper_outcomes_tenant_contact_idx' },
    { fields: ['tenant_key', 'signal_id', 'produced_at'], name: 'oper_outcomes_tenant_signal_idx' },
    { fields: ['tenant_key', 'recommendation_id', 'produced_at'], name: 'oper_outcomes_tenant_recommendation_idx' },
  ],
});
