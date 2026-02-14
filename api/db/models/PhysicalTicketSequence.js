/**
 * Model PhysicalTicketSequence - sequencing per day/queue/location.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PhysicalTicketSequence = null;

function getPhysicalTicketSequenceModel() {
  if (!PhysicalTicketSequence) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    PhysicalTicketSequence = sequelize.define('PhysicalTicketSequence', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      location_id: { type: DataTypes.STRING, allowNull: true },
      physical_queue_id: { type: DataTypes.STRING, allowNull: false },
      day: { type: DataTypes.DATEONLY, allowNull: false },
      last_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
      tableName: 'physical_ticket_sequences',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'location_id', 'physical_queue_id', 'day'], unique: true, name: 'physical_ticket_sequences_tenant_loc_queue_day_uq' },
      ],
    });
  }

  return PhysicalTicketSequence;
}

module.exports = getPhysicalTicketSequenceModel;

