/**
 * Model WebPushSubscription - subscriptions Web Push por tenant/usuário/dispositivo
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WebPushSubscription = null;

function getWebPushSubscriptionModel() {
  if (!WebPushSubscription) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    WebPushSubscription = sequelize.define('WebPushSubscription', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      subscription_json: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      device_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      last_seen_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    }, {
      tableName: 'web_push_subscriptions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['endpoint'], name: 'web_push_subscriptions_endpoint_uq', unique: true },
        { fields: ['tenant_id', 'user_id'], name: 'web_push_subscriptions_tenant_user_idx' },
      ],
    });
  }

  return WebPushSubscription;
}

module.exports = getWebPushSubscriptionModel;
