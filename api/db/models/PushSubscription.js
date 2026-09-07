const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PushSubscription = null;

function getPushSubscriptionModel() {
  if (!PushSubscription) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    PushSubscription = sequelize.define('PushSubscription', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      user_id: { type: DataTypes.STRING, allowNull: false },
      endpoint: { type: DataTypes.TEXT, allowNull: false },
      keys: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      device_name: { type: DataTypes.STRING, allowNull: true },
      user_agent: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'push_subscriptions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'user_id'], name: 'psub_tenant_user_idx' },
        { unique: true, fields: ['tenant_key', 'endpoint'], name: 'psub_tenant_endpoint_idx' },
      ],
    });
  }
  return PushSubscription;
}

module.exports = getPushSubscriptionModel;
