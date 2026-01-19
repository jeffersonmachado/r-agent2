/**
 * Model Webhook - Webhooks customizados (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Webhook = null;

function getWebhookModel() {
  if (!Webhook) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Webhook = sequelize.define('Webhook', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      events: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      secret: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      timeout: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5000,
      },
      retries: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      headers: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      stats: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          lastCallAt: null,
        },
      },
    }, {
      tableName: 'webhooks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'active'], name: 'webhooks_tenant_key_active_idx' },
        { fields: ['tenant_key'], name: 'webhooks_tenant_key_idx' },
      ],
    });
  }

  return Webhook;
}

module.exports = getWebhookModel;

