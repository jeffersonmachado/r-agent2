/**
 * Model OutboundAttempt - Ledger durável de tentativas de dispatch (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let OutboundAttempt = null;

function getOutboundAttemptModel() {
  if (!OutboundAttempt) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    OutboundAttempt = sequelize.define('OutboundAttempt', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      queue_item_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      client_message_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      channel_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'started',
      },
      result: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      external_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      idempotency_key: {
        type: DataTypes.STRING(256),
        allowNull: true,
      },
      error_class: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    }, {
      tableName: 'outbound_attempts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'queue_item_id'], name: 'outbound_attempts_tenant_queue_item_idx' },
        { fields: ['tenant_key', 'client_message_id'], name: 'outbound_attempts_tenant_client_msg_idx' },
      ],
    });
  }

  return OutboundAttempt;
}

module.exports = getOutboundAttemptModel;
