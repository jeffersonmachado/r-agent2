/**
 * Model PhysicalTicket - Senhas/atendimentos físicos (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PhysicalTicket = null;

function getPhysicalTicketModel() {
  if (!PhysicalTicket) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    PhysicalTicket = sequelize.define('PhysicalTicket', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      physical_queue_id: { type: DataTypes.STRING, allowNull: false },
      ticket_number: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'waiting' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      called_at: { type: DataTypes.DATE, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      station_id: { type: DataTypes.STRING, allowNull: true },
      context: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'physical_tickets',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'physical_queue_id', 'status'], name: 'physical_tickets_tenant_queue_status_idx' },
        { fields: ['tenant_key', 'created_at'], name: 'physical_tickets_tenant_key_created_at_idx' },
        { fields: ['tenant_key', 'ticket_number'], name: 'physical_tickets_tenant_key_ticket_number_idx' },
      ],
    });
  }

  return PhysicalTicket;
}

module.exports = getPhysicalTicketModel;

