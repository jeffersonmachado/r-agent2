/**
 * Model PhysicalQueue - Filas físicas (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PhysicalQueue = null;

function getPhysicalQueueModel() {
  if (!PhysicalQueue) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    PhysicalQueue = sequelize.define('PhysicalQueue', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      location_id: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      rules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'physical_queues',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'location_id', 'name'], name: 'physical_queues_tenant_location_name_uq', unique: true },
        { fields: ['tenant_key', 'status'], name: 'physical_queues_tenant_key_status_idx' },
        { fields: ['tenant_key', 'location_id'], name: 'physical_queues_tenant_key_location_id_idx' },
      ],
    });
  }

  return PhysicalQueue;
}

module.exports = getPhysicalQueueModel;

