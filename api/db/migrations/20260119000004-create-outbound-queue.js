/**
 * Migration: Create outbound_queue table (tenant_key-based)
 *
 * Simple retry queue for outbound messages with backoff.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'outbound_queue', {
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
      channel_account_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      conversation_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      message: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending | sending | sent | failed',
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      next_attempt_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      external_message_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'ID externo retornado pelo canal após envio',
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

    await addIndexIfNotExists(queryInterface, 'outbound_queue', ['tenant_key', 'status', 'next_attempt_at'], {
      name: 'outbound_queue_tenant_status_next_attempt_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('outbound_queue');
  },
};

