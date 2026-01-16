/**
 * Model TenantUser - Relacionamento entre Tenant e User (RBAC)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// TenantUser será definido quando Sequelize estiver disponível
let TenantUser = null;

function getTenantUserModel() {
  if (!TenantUser) {
    const sequelize = getSequelize();
    if (!sequelize) {
      // Retorna um objeto proxy que lança erro quando usado sem Sequelize
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    TenantUser = sequelize.define('TenantUser', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      role: {
        type: DataTypes.ENUM('owner', 'admin', 'member', 'support'),
        defaultValue: 'member',
        allowNull: false,
      },
    }, {
      tableName: 'tenant_users',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          unique: true,
          fields: ['tenant_id', 'user_id'],
          name: 'tenant_users_unique',
        },
        {
          fields: ['tenant_id'],
        },
        {
          fields: ['user_id'],
        },
        {
          fields: ['role'],
        },
      ],
    });
  }
  return TenantUser;
}

// Exporta função factory para lazy loading
module.exports = getTenantUserModel;
