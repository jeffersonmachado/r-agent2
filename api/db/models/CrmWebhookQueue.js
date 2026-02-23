const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmWebhookQueue = null;

function getCrmWebhookQueueModel() {
  if (!CrmWebhookQueue) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmWebhookQueue = sequelize.define('CrmWebhookQueue', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      webhook_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      event: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'success', 'failed', 'retry'),
        defaultValue: 'pending',
      },
      attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      error_message: {
        type: DataTypes.TEXT,
      },
      last_attempted_at: {
        type: DataTypes.DATE,
      },
      next_retry_at: {
        type: DataTypes.DATE,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'crm_webhook_queue',
      timestamps: false,
    });
  }

  return CrmWebhookQueue;
}

module.exports = getCrmWebhookQueueModel;
