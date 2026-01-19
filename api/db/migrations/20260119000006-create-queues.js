/**
 * Migration: Create queues table (tenant_key-based)
 *
 * Adds structured queue definitions for routing and SLA operations.
 * Keeps compatibility with legacy queueName usage (string).
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'queues', {
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
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      department_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      routing_strategy: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'manual',
        comment: 'round_robin | least_busy | manual',
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await addIndexIfNotExists(queryInterface, 'queues', ['tenant_key', 'name'], {
      name: 'queues_tenant_key_name_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'queues', ['tenant_key', 'active'], {
      name: 'queues_tenant_key_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'queues', ['tenant_key', 'department_id'], {
      name: 'queues_tenant_key_department_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('queues');
  },
};

