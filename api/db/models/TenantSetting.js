/**
 * Model TenantSetting - Configurações dinâmicas por tenant
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// TenantSetting será definido quando Sequelize estiver disponível
let TenantSetting = null;

function getTenantSettingModel() {
  if (!TenantSetting) {
    const sequelize = getSequelize();
    if (!sequelize) {
      // Retorna um objeto proxy que lança erro quando usado sem Sequelize
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    TenantSetting = sequelize.define('TenantSetting', {
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
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Chave da configuração (ex: "rag", "ui", "features")',
      },
      value: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'Valor da configuração (JSON)',
      },
    }, {
      tableName: 'tenant_settings',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          unique: true,
          fields: ['tenant_id', 'key'],
          name: 'tenant_settings_unique',
        },
        {
          fields: ['tenant_id'],
        },
        {
          fields: ['key'],
        },
      ],
    });
  }
  return TenantSetting;
}

// Exporta função factory para lazy loading
module.exports = getTenantSettingModel;
