/**
 * Model TicketEvent - eventos/timeline do ticket (tenant_key-based)
 *
 * Objetivo:
 * - Registrar eventos operacionais (handover, SLA, etc.) de forma consultável,
 *   sem depender apenas do JSONB `context`.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TicketEvent = null;

function getTicketEventModel() {
  if (!TicketEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    TicketEvent = sequelize.define('TicketEvent', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ticket_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'ticket_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'ticket_id', 'created_at'], name: 'ticket_events_tenant_ticket_created_idx' },
        { fields: ['tenant_key', 'type', 'created_at'], name: 'ticket_events_tenant_type_created_idx' },
      ],
    });
  }

  return TicketEvent;
}

module.exports = getTicketEventModel;

