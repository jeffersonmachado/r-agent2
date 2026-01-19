'use strict';

/**
 * Migration: Create webhooks table (tenant_key-based)
 *
 * Replaces webhooks.json with PostgreSQL persistence.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'webhooks', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      events: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      secret: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      timeout: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5000,
      },
      retries: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      headers: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      stats: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          lastCallAt: null,
        },
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

    await addIndexIfNotExists(queryInterface, 'webhooks', ['tenant_key', 'active'], {
      name: 'webhooks_tenant_key_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'webhooks', ['tenant_key'], {
      name: 'webhooks_tenant_key_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('webhooks');
  },
};

