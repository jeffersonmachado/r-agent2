const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ConversationFact', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  ticket_id: { type: DataTypes.STRING(128), allowNull: false },
  fact_key: { type: DataTypes.STRING(120), allowNull: false },
  fact_value: { type: DataTypes.TEXT, allowNull: false },
  confidence: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
  source: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'heuristic' },
  source_message_id: { type: DataTypes.STRING(191), allowNull: true },
  metadata_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata_json'), {}); },
    set(value) { this.setDataValue('metadata_json', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'conversation_facts',
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
    { fields: ['tenant_key', 'ticket_id', 'fact_key'], name: 'conv_facts_tenant_ticket_fact_key_uidx', unique: true },
    { fields: ['tenant_key', 'ticket_id', 'updated_at'], name: 'conv_facts_tenant_ticket_updated_idx' },
  ],
});
