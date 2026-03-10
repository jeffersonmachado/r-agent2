const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalSignal', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  contact_id: { type: DataTypes.STRING(191), allowNull: true },
  signal_type: { type: DataTypes.STRING(120), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
  severity: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'medium' },
  confidence: { type: DataTypes.DECIMAL(7, 4), allowNull: false, defaultValue: 0.5 },
  source_module: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'operational_agent' },
  context_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('context_json'), {}); },
    set(value) { this.setDataValue('context_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  detected_at: { type: DataTypes.DATE, allowNull: false },
  resolved_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'operational_signals',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status', 'detected_at'], name: 'oper_signals_tenant_status_detected_idx' },
    { fields: ['tenant_key', 'contact_id', 'status', 'detected_at'], name: 'oper_signals_tenant_contact_status_detected_idx' },
    { fields: ['tenant_key', 'signal_type', 'status', 'detected_at'], name: 'oper_signals_tenant_type_status_detected_idx' },
  ],
});
