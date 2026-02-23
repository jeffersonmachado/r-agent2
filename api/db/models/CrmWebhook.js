const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmWebhook = null;

function getCrmWebhookModel() {
  if (!CrmWebhook) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmWebhook = sequelize.define('CrmWebhook', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      events: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
      },
      headers: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      retry_attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 3,
      },
      retry_interval_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 60,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      secret: {
        type: DataTypes.STRING(255),
      },
    }, {
      tableName: 'crm_webhooks',
      timestamps: true,
      underscored: true,
    });
  }

  return CrmWebhook;
}

module.exports = getCrmWebhookModel;
