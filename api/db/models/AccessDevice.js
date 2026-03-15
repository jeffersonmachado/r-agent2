const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessDevice = null;

function getAccessDeviceModel() {
  if (!AccessDevice) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessDevice = sequelize.define('AccessDevice', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      vendor: { type: DataTypes.STRING, allowNull: true },
      model: { type: DataTypes.STRING, allowNull: true },
      ip: { type: DataTypes.STRING, allowNull: true },
      location: { type: DataTypes.STRING, allowNull: true },
      unit_id: { type: DataTypes.STRING, allowNull: true },
      integration_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'backend_decides' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_devices',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'type', 'status'], name: 'access_devices_tenant_type_status_idx' },
        { fields: ['tenant_key', 'unit_id'], name: 'access_devices_tenant_unit_idx' },
      ],
    });
  }

  return AccessDevice;
}

module.exports = getAccessDeviceModel;
