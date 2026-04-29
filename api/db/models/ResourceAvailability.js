'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');
let ResourceAvailability = null;
function getResourceAvailabilityModel() {
  if (!ResourceAvailability) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    ResourceAvailability = sequelize.define('ResourceAvailability', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      resource_id: { type: DataTypes.UUID, allowNull: false },
      starts_at: { type: DataTypes.DATE, allowNull: false },
      ends_at: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'available' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, { tableName: 'resource_availabilities', timestamps: true, underscored: true, indexes: [{ fields: ['tenant_id', 'resource_id', 'starts_at'], name: 'resource_avail_tenant_resource_start_idx' }] });
  }
  return ResourceAvailability;
}
module.exports = getResourceAvailabilityModel;
