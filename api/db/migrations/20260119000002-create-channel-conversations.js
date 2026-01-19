/**
 * Migration: Create channel_conversations table (tenant_key-based)
 *
 * Unifies omnichannel conversations under a single model.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'channel_conversations', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      channel_type: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'whatsapp | instagram | webchat',
      },
      external_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'ID externo da conversa/contato no canal (ex: phone/userId)',
      },
      contact_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Identificador interno do contato (quando existir)',
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'open',
        comment: 'open | paused | human | bot | closed',
      },
      current_ticket_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await addIndexIfNotExists(queryInterface, 'channel_conversations', ['tenant_key', 'status'], {
      name: 'channel_conversations_tenant_key_status_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_conversations', ['tenant_key', 'channel_type'], {
      name: 'channel_conversations_tenant_key_channel_type_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_conversations', ['tenant_key', 'current_ticket_id'], {
      name: 'channel_conversations_tenant_key_current_ticket_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_conversations', ['tenant_key', 'last_message_at'], {
      name: 'channel_conversations_tenant_key_last_message_at_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_conversations', ['tenant_key', 'channel_type', 'external_id'], {
      name: 'channel_conversations_unique_external',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('channel_conversations');
  },
};

