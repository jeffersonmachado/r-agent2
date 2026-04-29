'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');
let ResourceBooking = null;
function getResourceBookingModel() {
  if (!ResourceBooking) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    ResourceBooking = sequelize.define('ResourceBooking', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      resource_id: { type: DataTypes.UUID, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      task_id: { type: DataTypes.UUID, allowNull: true },
      starts_at: { type: DataTypes.DATE, allowNull: false },
      ends_at: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'booked' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, { tableName: 'resource_bookings', timestamps: true, underscored: true, indexes: [{ fields: ['tenant_id', 'resource_id', 'starts_at'], name: 'resource_bookings_tenant_resource_start_idx' }, { fields: ['tenant_id', 'entity_id'], name: 'resource_bookings_tenant_entity_idx' }] });
  }
  return ResourceBooking;
}
module.exports = getResourceBookingModel;
