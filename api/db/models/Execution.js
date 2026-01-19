/**
 * Model Execution - Persistência determinística de execuções
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Execution = null;

function getExecutionModel() {
  if (!Execution) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Execution = sequelize.define('Execution', {
      execution_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'executions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['status'], name: 'executions_status_idx' },
        { fields: ['created_at'], name: 'executions_created_at_idx' },
        { fields: ['updated_at'], name: 'executions_updated_at_idx' },
      ],
    });
  }

  return Execution;
}

module.exports = getExecutionModel;

