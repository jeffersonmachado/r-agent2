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
          fields: ['email'],
        },
        {
          fields: ['is_superadmin'],
        },
      ],
    });
  }
  return User;
}

// Exporta função factory para lazy loading
module.exports = getUserModel;
