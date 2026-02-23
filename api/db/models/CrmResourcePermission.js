const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmResourcePermission = null;

function getCrmResourcePermissionModel() {
  if (!CrmResourcePermission) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmResourcePermission = sequelize.define('CrmResourcePermission', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      resource_type: {
        type: DataTypes.ENUM('account', 'contact', 'lead', 'pipeline', 'opportunity', 'activity'),
        allowNull: false,
      },
      resource_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      permission_level: {
        type: DataTypes.ENUM('view', 'edit', 'delete', 'owner'),
        defaultValue: 'view',
      },
      granted_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'crm_resource_permissions',
      timestamps: false,
    });
  }

  return CrmResourcePermission;
}

module.exports = getCrmResourcePermissionModel;
