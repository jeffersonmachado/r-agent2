/**
 * Migration: Create executions table
 *
 * Stores deterministic execution decisions for the pipeline (DB-only persistence).
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'executions', {
      execution_id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      data: {
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

    await addIndexIfNotExists(queryInterface, 'executions', ['status'], {
      name: 'executions_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'executions', ['created_at'], {
      name: 'executions_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'executions', ['updated_at'], {
      name: 'executions_updated_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('executions');
  },
};

