/**
 * Migration: Create deliveries table (tenant_key-based)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'deliveries', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      order_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'pending',
      },
      courier_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      courier_phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      tracking_code: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      tracking_url: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      delivery_address: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      estimated_delivery_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      dispatched_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      delivered_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      context: {
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

    await addIndexIfNotExists(queryInterface, 'deliveries', ['tenant_key', 'order_id'], {
      name: 'deliveries_tenant_key_order_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'deliveries', ['tenant_key', 'status'], {
      name: 'deliveries_tenant_key_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'deliveries', ['tenant_key', 'created_at'], {
      name: 'deliveries_tenant_key_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('deliveries');
  },
};

