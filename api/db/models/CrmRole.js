const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmRole = null;

function getCrmRoleModel() {
  if (!CrmRole) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmRole = sequelize.define('CrmRole', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
      },
      permissions: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      is_system: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      metadata: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    }, {
      tableName: 'crm_roles',
      timestamps: true,
      underscored: true,
    });
  }

  return CrmRole;
}

module.exports = getCrmRoleModel;
