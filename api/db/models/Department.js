/**
 * Model Department - Departamentos (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Department = null;

function getDepartmentModel() {
  if (!Department) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Department = sequelize.define('Department', {
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
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      agent_ids: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      queue_names: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      color: {
        type: DataTypes.STRING,
        allowNull: true,
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
      tableName: 'departments',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'active'], name: 'departments_tenant_key_active_idx' },
        { fields: ['tenant_key', 'name'], name: 'departments_tenant_key_name_idx' },
      ],
    });
  }

  return Department;
}

module.exports = getDepartmentModel;

