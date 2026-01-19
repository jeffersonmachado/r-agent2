/**
 * Migration: Create channel_messages table (tenant_key-based)
 *
 * Stores normalized inbound/outbound messages for omnichannel conversations.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'channel_messages', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      conversation_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      direction: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'in | out',
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'text | image | audio | document | template | interactive',
      },
      body: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      external_message_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'received',
        comment: 'received | sent | delivered | read | failed',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'channel_messages', ['tenant_key', 'conversation_id', 'created_at'], {
      name: 'channel_messages_tenant_conv_created_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_messages', ['tenant_key', 'external_message_id'], {
      name: 'channel_messages_tenant_external_msg_id_uq',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('channel_messages');
  },
};

