const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ConversationEvent', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  ticket_id: { type: DataTypes.STRING(128), allowNull: false },
  conversation_id: { type: DataTypes.STRING(128), allowNull: true },
  event_type: { type: DataTypes.STRING(120), allowNull: false },
  direction: { type: DataTypes.STRING(20), allowNull: true },
  message_id: { type: DataTypes.STRING(191), allowNull: true },
  payload_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('payload_json'), {}); },
    set(value) { this.setDataValue('payload_json', stringifyJsonText(value, {})); },
  },
  occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'conversation_events',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('payload_json')) {
        instance.setDataValue('payload_json', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'ticket_id', 'occurred_at'], name: 'conv_events_tenant_ticket_occurred_idx' },
    { fields: ['tenant_key', 'conversation_id', 'occurred_at'], name: 'conv_events_tenant_conversation_occurred_idx' },
    { fields: ['tenant_key', 'event_type', 'occurred_at'], name: 'conv_events_tenant_type_occurred_idx' },
  ],
});
