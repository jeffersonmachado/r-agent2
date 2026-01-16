/**
 * Migration: Create audit_logs table
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'audit_logs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'SET NULL',
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
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entity: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      meta: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'audit_logs', ['tenant_id', 'created_at'], {
      name: 'audit_logs_tenant_id_created_at_idx',
    });

    await addIndexIfNotExists(queryInterface, 'audit_logs', ['actor_user_id'], {
      name: 'audit_logs_actor_user_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'audit_logs', ['action'], {
      name: 'audit_logs_action_idx',
    });

    await addIndexIfNotExists(queryInterface, 'audit_logs', ['entity'], {
      name: 'audit_logs_entity_idx',
    });

    await addIndexIfNotExists(queryInterface, 'audit_logs', ['created_at'], {
      name: 'audit_logs_created_at_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('audit_logs');
  },
};
