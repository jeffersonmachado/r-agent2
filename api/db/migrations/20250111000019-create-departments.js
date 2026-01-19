'use strict';

/**
 * Migration: Create departments table (tenant_key-based)
 *
 * Replaces departments.json with PostgreSQL persistence.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'departments', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      agent_ids: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      queue_names: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      color: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: Sequelize.STRING,
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

    await addIndexIfNotExists(queryInterface, 'departments', ['tenant_key', 'active'], {
      name: 'departments_tenant_key_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'departments', ['tenant_key', 'name'], {
      name: 'departments_tenant_key_name_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('departments');
  },
};

