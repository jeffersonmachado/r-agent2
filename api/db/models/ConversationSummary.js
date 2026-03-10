const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ConversationSummary', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  ticket_id: { type: DataTypes.STRING(128), allowNull: false },
  conversation_id: { type: DataTypes.STRING(128), allowNull: true },
  summary_kind: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'rolling' },
  summary_text: { type: DataTypes.TEXT, allowNull: false },
  window_start_at: { type: DataTypes.DATE, allowNull: true },
  window_end_at: { type: DataTypes.DATE, allowNull: true },
  message_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  metadata_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata_json'), {}); },
    set(value) { this.setDataValue('metadata_json', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'conversation_summaries',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata_json')) {
        instance.setDataValue('metadata_json', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'ticket_id', 'created_at'], name: 'conv_summaries_tenant_ticket_created_idx' },
    { fields: ['tenant_key', 'conversation_id', 'created_at'], name: 'conv_summaries_tenant_conversation_created_idx' },
  ],
});
