/**
 * Model OutboundQueueItem - Fila de saída com retry/backoff (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let OutboundQueueItem = null;

function getOutboundQueueItemModel() {
  if (!OutboundQueueItem) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    OutboundQueueItem = sequelize.define('OutboundQueueItem', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      channel_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      channel_account_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      conversation_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      message: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      next_attempt_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      external_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'outbound_queue',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'next_attempt_at'], name: 'outbound_queue_tenant_status_next_attempt_idx' },
      ],
    });
  }

  return OutboundQueueItem;
}

module.exports = getOutboundQueueItemModel;

