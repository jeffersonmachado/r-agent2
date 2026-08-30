/**
 * Migration: Create case_conversations table (tenant_key-based)
 *
 * Link N:N entre Case (ticket legado) e ChannelConversation.
 * Reversível: down() faz dropTable.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'case_conversations', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      case_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'ID do case (ticket legado; tabela tickets não renomeada)',
      },
      conversation_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'ID da ChannelConversation vinculada ao case',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
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

    await addIndexIfNotExists(queryInterface, 'case_conversations', ['tenant_key', 'case_id'], {
      name: 'case_conversations_tenant_key_case_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'case_conversations', ['tenant_key', 'conversation_id'], {
      name: 'case_conversations_tenant_key_conversation_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'case_conversations', ['tenant_key', 'case_id', 'conversation_id'], {
      name: 'case_conversations_unique_link',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('case_conversations');
  },
};
