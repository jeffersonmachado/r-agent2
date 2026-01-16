/**
 * Migration: Create sessions table
 *
 * Stores API auth sessions (token-based) in PostgreSQL.
 *
 * NOTE: We use token as primary key to keep compatibility with the current API.
 */
 
'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'sessions', {
      token: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      agent_snapshot: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      last_activity_at: {
        type: Sequelize.DATE,
        allowNull: false,
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

    await addIndexIfNotExists(queryInterface, 'sessions', ['user_id'], {
      name: 'sessions_user_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'sessions', ['tenant_key'], {
      name: 'sessions_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'sessions', ['expires_at'], {
      name: 'sessions_expires_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'sessions', ['last_activity_at'], {
      name: 'sessions_last_activity_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sessions');
  },
};

