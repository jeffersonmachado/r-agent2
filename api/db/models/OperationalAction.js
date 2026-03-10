const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalAction', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  contact_id: { type: DataTypes.STRING(191), allowNull: true },
  source_type: { type: DataTypes.STRING(30), allowNull: false },
  source_id: { type: DataTypes.STRING(191), allowNull: false },
  action_id: { type: DataTypes.STRING(120), allowNull: false },
  actor_type: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'system' },
  actor_id: { type: DataTypes.STRING(191), allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'executed' },
  input_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('input_json'), {}); },
    set(value) { this.setDataValue('input_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  result_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('result_json'), {}); },
    set(value) { this.setDataValue('result_json', value == null ? null : stringifyJsonText(value, {})); },
  },
  error_message: { type: DataTypes.TEXT, allowNull: true },
  executed_at: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'operational_actions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status', 'executed_at'], name: 'oper_actions_tenant_status_executed_idx' },
    { fields: ['tenant_key', 'contact_id', 'executed_at'], name: 'oper_actions_tenant_contact_executed_idx' },
    { fields: ['tenant_key', 'source_type', 'source_id'], name: 'oper_actions_tenant_source_idx' },
  ],
});
