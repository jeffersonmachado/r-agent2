/**
 * Migration: Create orders table (tenant_key-based)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'orders', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      order_number: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'created',
      },
      source: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'storefront',
      },
      location_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      customer_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      customer_phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      items: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      total_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      delivery_type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'delivery',
      },
      delivery_address: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      context: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      preparing_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ready_at: {
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
      cancelled_at: {
        type: Sequelize.DATE,
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

    await addIndexIfNotExists(queryInterface, 'orders', ['tenant_key', 'order_number'], {
      name: 'orders_tenant_key_order_number_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'orders', ['tenant_key', 'status'], {
      name: 'orders_tenant_key_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'orders', ['tenant_key', 'created_at'], {
      name: 'orders_tenant_key_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'orders', ['tenant_key', 'location_id'], {
      name: 'orders_tenant_key_location_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'orders', ['tenant_key', 'customer_phone'], {
      name: 'orders_tenant_key_customer_phone_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('orders');
  },
};

