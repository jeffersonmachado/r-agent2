/**
 * Model Flow - FlowDefinitions persistidos
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Flow = null;

function getFlowModel() {
  if (!Flow) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Flow = sequelize.define('Flow', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'flows',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'updated_at'], name: 'flows_tenant_key_updated_at_idx' },
        { fields: ['name'], name: 'flows_name_idx' },
      ],
    });
  }

  return Flow;
}

module.exports = getFlowModel;

