/**
 * Model User - Representa um usuário do sistema
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// User será definido quando Sequelize estiver disponível
let User = null;

function getUserModel() {
  if (!User) {
    const sequelize = getSequelize();
    if (!sequelize) {
      // Retorna um objeto proxy que lança erro quando usado sem Sequelize
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    User = sequelize.define('User', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'Username (login) - legado do modo JSON',
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password_hash: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Hash da senha (bcrypt)',
      },
      role: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'admin',
        comment: 'Role aplicado pelo RBAC (owner/admin/manager/operator/auditor/readonly/super_admin)',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'active',
      },
      mfa_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      invitation_token: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      invitation_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      password_reset_token: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      password_reset_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
        comment: 'Tenant principal do usuário (multi-tenant obrigatório)',
      },
      is_superadmin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    }, {
      tableName: 'users',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          unique: true,
          fields: ['username'],
          name: 'users_username_unique',
        },
        {
          unique: true,
          fields: ['email'],
        },
        {
          fields: ['role'],
          name: 'users_role_idx',
        },
        {
          fields: ['is_active'],
          name: 'users_is_active_idx',
        },
        {
          fields: ['status'],
          name: 'users_status_idx',
        },
        {
          fields: ['tenant_key'],
          name: 'users_tenant_key_idx',
        },
        {
          fields: ['is_superadmin'],
        },
        {
          fields: ['invitation_token'],
          name: 'users_invitation_token_idx',
        },
        {
          fields: ['password_reset_token'],
          name: 'users_password_reset_token_idx',
        },
        {
          fields: ['last_login_at'],
          name: 'users_last_login_at_idx',
        },
      ],
    });
  }
  return User;
}

// Exporta função factory para lazy loading
module.exports = getUserModel;
