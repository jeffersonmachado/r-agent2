/**
 * Migration: Create flows table (tenant_key-based)
 *
 * Persists FlowDefinitions (visual editor) in PostgreSQL.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'flows', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
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

    await addIndexIfNotExists(queryInterface, 'flows', ['tenant_key', 'updated_at'], {
      name: 'flows_tenant_key_updated_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'flows', ['name'], {
      name: 'flows_name_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('flows');
  },
};

