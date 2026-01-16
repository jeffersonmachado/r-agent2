/**
 * Migration: Create tenant_users table (RBAC)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_users', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
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
      role: {
        type: Sequelize.ENUM('owner', 'admin', 'member', 'support'),
        defaultValue: 'member',
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

    await addIndexIfNotExists(queryInterface, 'tenant_users', ['tenant_id', 'user_id'], {
      unique: true,
      name: 'tenant_users_unique',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_users', ['tenant_id'], {
      name: 'tenant_users_tenant_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_users', ['user_id'], {
      name: 'tenant_users_user_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_users', ['role'], {
      name: 'tenant_users_role_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tenant_users');
  },
};
