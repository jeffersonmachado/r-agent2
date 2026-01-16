/**
 * Model TenantAISetting - Configurações de IA por tenant (sem segredos)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// TenantAISetting será definido quando Sequelize estiver disponível
let TenantAISetting = null;

function getTenantAISettingModel() {
  if (!TenantAISetting) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    TenantAISetting = sequelize.define('TenantAISetting', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING,
        defaultValue: 'openai',
        allowNull: false,
        comment: 'Provider de IA (openai, anthropic, etc.) - mantido para compatibilidade',
      },
      primary: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'primary', // Sequelize adiciona aspas automaticamente para palavras reservadas
        comment: 'Provider primário de IA (openai, anthropic, etc.)',
      },
      secondary: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Provider secundário de IA (openai, anthropic, etc.)',
      },
      model: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Modelo a ser usado (ex: gpt-4, claude-3, etc.)',
      },
      temperature: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        comment: 'Temperatura do modelo (0.0 a 2.0)',
      },
      max_tokens: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Número máximo de tokens',
      },
      quota_monthly: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Quota mensal de tokens',
      },
    }, {
      tableName: 'tenant_ai_settings',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          unique: true,
          fields: ['tenant_id'],
        },
        {
          fields: ['enabled'],
        },
        {
          fields: ['provider'],
        },
      ],
    });
  }
  return TenantAISetting;
}

module.exports = getTenantAISettingModel;
