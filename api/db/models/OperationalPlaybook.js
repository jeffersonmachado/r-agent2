const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalPlaybook', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  playbook_key: { type: DataTypes.STRING(120), allowNull: false },
  name: { type: DataTypes.STRING(191), allowNull: false },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' },
  trigger_signal: { type: DataTypes.STRING(120), allowNull: true },
  definition_json: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() { return parseJsonText(this.getDataValue('definition_json'), {}); },
    set(value) { this.setDataValue('definition_json', value == null ? null : stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'operational_playbooks',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status', 'updated_at'], name: 'oper_playbooks_tenant_status_updated_idx' },
    { fields: ['tenant_key', 'playbook_key'], name: 'oper_playbooks_tenant_key_uq', unique: true },
    { fields: ['tenant_key', 'trigger_signal'], name: 'oper_playbooks_tenant_trigger_idx' },
  ],
});
