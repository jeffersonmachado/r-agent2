/**
 * Model ChannelConversation - Conversas omnichannel (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ChannelConversation = null;

function getChannelConversationModel() {
  if (!ChannelConversation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ChannelConversation = sequelize.define('ChannelConversation', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      channel_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      external_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      contact_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'open',
      },
      current_ticket_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      assigned_to: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      last_message_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, {
      tableName: 'channel_conversations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'channel_conversations_tenant_key_status_idx' },
        { fields: ['tenant_key', 'channel_type'], name: 'channel_conversations_tenant_key_channel_type_idx' },
        { fields: ['tenant_key', 'current_ticket_id'], name: 'channel_conversations_tenant_key_current_ticket_id_idx' },
        { fields: ['tenant_key', 'last_message_at'], name: 'channel_conversations_tenant_key_last_message_at_idx' },
        { fields: ['tenant_key', 'channel_type', 'external_id'], name: 'channel_conversations_unique_external', unique: true },
      ],
    });
  }

  return ChannelConversation;
}

module.exports = getChannelConversationModel;

