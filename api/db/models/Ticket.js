/**
 * Model Ticket - Atendimento humano
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Ticket = null;

function getTicketModel() {
  if (!Ticket) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Ticket = sequelize.define('Ticket', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      session_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      conversation_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      channel_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      queue: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'waiting',
      },
      mode: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'human',
      },
      pause_reason: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      assigned_to: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone_number: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      last_user_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      unread_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      tags: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      category: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      messages: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      context: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'tickets',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'tickets_tenant_key_status_idx' },
        { fields: ['tenant_key', 'queue'], name: 'tickets_tenant_key_queue_idx' },
        { fields: ['session_id'], name: 'tickets_session_id_idx' },
        { fields: ['tenant_key', 'conversation_id'], name: 'tickets_tenant_key_conversation_id_idx' },
        { fields: ['tenant_key', 'mode'], name: 'tickets_tenant_key_mode_idx' },
        { fields: ['created_at'], name: 'tickets_created_at_idx' },
      ],
    });
  }

  return Ticket;
}

module.exports = getTicketModel;

