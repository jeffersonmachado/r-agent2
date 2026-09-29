/**
 * Model TenantAICredential - Credenciais de IA por tenant (criptografadas)
 * 
 * IMPORTANTE: api_key_encrypted contém a API key criptografada.
 * Nunca retornar este campo via API pública.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// TenantAICredential será definido quando Sequelize estiver disponível
let TenantAICredential = null;

function getTenantAICredentialModel() {
  if (!TenantAICredential) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    TenantAICredential = sequelize.define('TenantAICredential', {
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
      provider: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Provider de IA (openai, anthropic, etc.)',
      },
      api_key_encrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'API key criptografada (AES-256-GCM)',
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'unknown',
        comment: 'unknown|valid|invalid_token|no_credit|error — resultado do último teste real',
      },
      last_tested_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Ex.: { balance: { status, amount, currency, note, checkedAt } } — status em available/requires_admin_key/not_supported/error (consulta feita para TODOS os providers)',
      },
    }, {
      tableName: 'tenant_ai_credentials',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          unique: true,
          fields: ['tenant_id', 'provider'],
          name: 'tenant_ai_credentials_unique',
        },
        {
          fields: ['tenant_id'],
        },
        {
          fields: ['provider'],
        },
      ],
    });
  }
  return TenantAICredential;
}

module.exports = getTenantAICredentialModel;
