/**
 * Model Delivery - Entregas (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Delivery = null;

function getDeliveryModel() {
  if (!Delivery) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    Delivery = sequelize.define('Delivery', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      order_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending',
      },
      courier_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      courier_phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tracking_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tracking_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      delivery_address: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      estimated_delivery_at: {
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
      context: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'deliveries',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'order_id'], name: 'deliveries_tenant_key_order_id_idx' },
        { fields: ['tenant_key', 'status'], name: 'deliveries_tenant_key_status_idx' },
        { fields: ['tenant_key', 'created_at'], name: 'deliveries_tenant_key_created_at_idx' },
      ],
    });
  }

  return Delivery;
}

module.exports = getDeliveryModel;

