const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('UraDecisionAudit', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  ticket_id: { type: DataTypes.STRING(128), allowNull: true },
  message_id: { type: DataTypes.STRING(191), allowNull: true },
  intent: { type: DataTypes.STRING(120), allowNull: true },
  secondary_intent: { type: DataTypes.STRING(120), allowNull: true },
  confidence: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
  fallback_used: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  department_id: { type: DataTypes.STRING(128), allowNull: true },
  queue_name: { type: DataTypes.STRING(191), allowNull: true },
  rag_used: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  provider_status: { type: DataTypes.STRING(40), allowNull: true },
  latency_ms: { type: DataTypes.INTEGER, allowNull: true },
  context_used_summary_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('context_used_summary_json'), null); },
    set(value) { this.setDataValue('context_used_summary_json', value == null ? null : stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'ura_decision_audits',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'created_at'], name: 'ura_audit_tenant_created_idx' },
    { fields: ['tenant_key', 'ticket_id'], name: 'ura_audit_tenant_ticket_idx' },
    { fields: ['tenant_key', 'provider_status'], name: 'ura_audit_tenant_provider_idx' },
    { fields: ['tenant_key', 'department_id'], name: 'ura_audit_tenant_department_idx' },
  ],
});
