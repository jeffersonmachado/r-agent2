/**
 * Model Order - Pedidos (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Order = null;

function getOrderModel() {
  if (!Order) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    Order = sequelize.define('Order', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      order_number: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'created',
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'storefront',
      },
      location_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customer_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      customer_phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      delivery_type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'delivery',
      },
      delivery_address: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      context: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      confirmed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      preparing_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ready_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      dispatched_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      delivered_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, {
      tableName: 'orders',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'order_number'], name: 'orders_tenant_key_order_number_uq', unique: true },
        { fields: ['tenant_key', 'status'], name: 'orders_tenant_key_status_idx' },
        { fields: ['tenant_key', 'created_at'], name: 'orders_tenant_key_created_at_idx' },
        { fields: ['tenant_key', 'location_id'], name: 'orders_tenant_key_location_id_idx' },
        { fields: ['tenant_key', 'customer_phone'], name: 'orders_tenant_key_customer_phone_idx' },
      ],
    });
  }

  return Order;
}

module.exports = getOrderModel;

