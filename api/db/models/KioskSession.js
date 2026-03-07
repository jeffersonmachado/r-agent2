const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('KioskSession', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  kiosk_code: { type: DataTypes.STRING(100), allowNull: false },
  session_token: { type: DataTypes.STRING(100), allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: true },
  ticket_id: { type: DataTypes.STRING(128), allowNull: true },
  status_reason: { type: DataTypes.STRING(120), allowNull: true },
  checkin_at: { type: DataTypes.DATE, allowNull: true },
  closed_at: { type: DataTypes.DATE, allowNull: true },
  metadata_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata_json'), {}); },
    set(value) { this.setDataValue('metadata_json', stringifyJsonText(value, {})); },
  },
  context_payload: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('context_payload'), {}); },
    set(value) { this.setDataValue('context_payload', stringifyJsonText(value, {})); },
  },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'open' },
}, {
  tableName: 'kiosk_sessions',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata_json')) instance.setDataValue('metadata_json', '{}');
      if (!instance.getDataValue('context_payload')) instance.setDataValue('context_payload', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'kiosk_code'], name: 'kiosk_sessions_tenant_kiosk_idx' },
    { fields: ['session_token'], name: 'kiosk_sessions_token_uidx', unique: true },
  ],
});
