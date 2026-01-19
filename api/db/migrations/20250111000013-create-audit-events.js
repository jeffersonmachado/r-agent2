/**
 * Migration: Create audit_events table (tenant_key-based)
 *
 * The existing audit_logs table uses tenant_id UUID foreign keys, but the app
 * uses tenant identifiers (tenant_key) widely. This table is a practical
 * source of truth for API audit endpoints.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'audit_events', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      username: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      resource: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      resource_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      ip_address: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
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

    await addIndexIfNotExists(queryInterface, 'audit_events', ['tenant_key', 'created_at'], {
      name: 'audit_events_tenant_key_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'audit_events', ['actor_user_id', 'created_at'], {
      name: 'audit_events_actor_user_id_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'audit_events', ['action'], {
      name: 'audit_events_action_idx',
    });
    await addIndexIfNotExists(queryInterface, 'audit_events', ['resource'], {
      name: 'audit_events_resource_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_events');
  },
};

