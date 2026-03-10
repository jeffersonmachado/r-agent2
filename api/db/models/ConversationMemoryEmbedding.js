const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ConversationMemoryEmbedding', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  ticket_id: { type: DataTypes.STRING(128), allowNull: false },
  conversation_id: { type: DataTypes.STRING(128), allowNull: true },
  source_type: { type: DataTypes.STRING(60), allowNull: false },
  source_id: { type: DataTypes.STRING(191), allowNull: true },
  content: { type: DataTypes.TEXT, allowNull: false },
  embedding: { type: DataTypes.TEXT, allowNull: false },
  metadata_json: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata_json'), {}); },
    set(value) { this.setDataValue('metadata_json', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'conversation_memory_embeddings',
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
    { fields: ['tenant_key', 'ticket_id', 'created_at'], name: 'conv_memory_tenant_ticket_created_idx' },
    { fields: ['tenant_key', 'conversation_id', 'created_at'], name: 'conv_memory_tenant_conversation_created_idx' },
    { fields: ['tenant_key', 'source_type'], name: 'conv_memory_tenant_source_type_idx' },
  ],
});
