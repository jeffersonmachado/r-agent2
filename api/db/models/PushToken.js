/**
 * Model PushToken - Tokens de push notifications por tenant/usuário/dispositivo
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PushToken = null;

function getPushTokenModel() {
  if (!PushToken) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    PushToken = sequelize.define('PushToken', {
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
      platform: {
        type: DataTypes.ENUM('android', 'ios'),
        allowNull: false,
      },
      token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      device_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      device_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      app_version: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      last_seen_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    }, {
      tableName: 'push_tokens',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['platform', 'token'], name: 'push_tokens_platform_token_uq', unique: true },
        { fields: ['tenant_id', 'user_id'], name: 'push_tokens_tenant_user_idx' },
      ],
    });
  }

  return PushToken;
}

module.exports = getPushTokenModel;
