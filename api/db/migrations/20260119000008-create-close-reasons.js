/**
 * Migration: Create close_reasons table (tenant_key-based)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'close_reasons', {
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

    await addIndexIfNotExists(queryInterface, 'close_reasons', ['tenant_key', 'active'], {
      name: 'close_reasons_tenant_key_active_idx',
    });

    await addIndexIfNotExists(queryInterface, 'close_reasons', ['tenant_key', 'name'], {
      name: 'close_reasons_tenant_key_name_uq',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('close_reasons');
  },
};

