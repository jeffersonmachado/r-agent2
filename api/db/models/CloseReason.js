/**
 * Model CloseReason - Motivos de encerramento (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CloseReason = null;

function getCloseReasonModel() {
  if (!CloseReason) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    CloseReason = sequelize.define('CloseReason', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'close_reasons',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'active'], name: 'close_reasons_tenant_key_active_idx' },
        { fields: ['tenant_key', 'name'], name: 'close_reasons_tenant_key_name_uq', unique: true },
      ],
    });
  }

  return CloseReason;
}

module.exports = getCloseReasonModel;

