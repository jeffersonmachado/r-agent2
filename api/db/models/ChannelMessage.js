/**
 * Model ChannelMessage - Mensagens omnichannel (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ChannelMessage = null;

function getChannelMessageModel() {
  if (!ChannelMessage) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ChannelMessage = sequelize.define('ChannelMessage', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      conversation_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      direction: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      body: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      external_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'received',
      },
    }, {
      tableName: 'channel_messages',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'conversation_id', 'created_at'], name: 'channel_messages_tenant_conv_created_idx' },
        { fields: ['tenant_key', 'external_message_id'], name: 'channel_messages_tenant_external_msg_id_uq', unique: true },
      ],
    });
  }

  return ChannelMessage;
}

module.exports = getChannelMessageModel;

