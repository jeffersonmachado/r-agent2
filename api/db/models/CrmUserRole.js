const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmUserRole = null;

function getCrmUserRoleModel() {
  if (!CrmUserRole) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmUserRole = sequelize.define('CrmUserRole', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      assigned_by: {
        type: DataTypes.STRING(255),
      },
      assigned_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'crm_user_roles',
      timestamps: false,
    });
  }

  return CrmUserRole;
}

module.exports = getCrmUserRoleModel;
