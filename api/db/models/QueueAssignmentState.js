/**
 * Model QueueAssignmentState - estado de round-robin por fila (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let QueueAssignmentState = null;

function getQueueAssignmentStateModel() {
  if (!QueueAssignmentState) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    QueueAssignmentState = sequelize.define('QueueAssignmentState', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      queue_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      cursor: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      updated_by: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'queue_assignment_states',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'queue_name'], name: 'queue_assignment_states_tenant_queue_uq', unique: true },
        { fields: ['tenant_key', 'updated_at'], name: 'queue_assignment_states_tenant_updated_idx' },
      ],
    });
  }

  return QueueAssignmentState;
}

module.exports = getQueueAssignmentStateModel;

