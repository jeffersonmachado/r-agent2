/**
 * Migration: Create tickets table (tenant_key-based)
 *
 * Stores human support tickets and messages as JSONB to remove filesystem dependency.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tickets', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      queue: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'waiting',
      },
      assigned_to: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      phone_number: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      last_user_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      unread_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      tags: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      messages: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      context: {
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

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'status'], {
      name: 'tickets_tenant_key_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'queue'], {
      name: 'tickets_tenant_key_queue_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tickets', ['session_id'], {
      name: 'tickets_session_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tickets', ['created_at'], {
      name: 'tickets_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tickets');
  },
};

