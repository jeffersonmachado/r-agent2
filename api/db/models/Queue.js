/**
 * Model Queue - Definição de fila (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Queue = null;

function getQueueModel() {
  if (!Queue) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    Queue = sequelize.define('Queue', {
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
      priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      department_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      routing_strategy: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'manual',
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    }, {
      tableName: 'queues',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'name'], name: 'queues_tenant_key_name_uq', unique: true },
        { fields: ['tenant_key', 'active'], name: 'queues_tenant_key_active_idx' },
        { fields: ['tenant_key', 'department_id'], name: 'queues_tenant_key_department_id_idx' },
      ],
    });
  }

  return Queue;
}

module.exports = getQueueModel;

