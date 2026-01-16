/**
 * Model Tenant - Representa um tenant (cliente) do sistema SaaS
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// Tenant será definido quando Sequelize estiver disponível
let Tenant = null;

function getTenantModel() {
  if (!Tenant) {
    const sequelize = getSequelize();
    if (!sequelize) {
      // Retorna um objeto proxy que lança erro quando usado sem Sequelize
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    Tenant = sequelize.define('Tenant', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  tenant_key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Chave única do tenant (ex: "studiooly", "system")',
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  site: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  ramo_atividade: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  objetivo: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('trial', 'active', 'suspended', 'terminated'),
    defaultValue: 'trial',
    allowNull: false,
  },
  plan: {
    type: DataTypes.ENUM('free', 'trial', 'pro', 'enterprise'),
    defaultValue: 'trial',
    allowNull: false,
  },
  limits: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Limites do plano (usuários, agentes_ia, execucoes_rpa, tokens_ia, etc.)',
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Configurações gerais do tenant',
  },
  branding: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Branding personalizado (logo, cores, etc.)',
  },
  suspended_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'suspended_at',
  },
  trial_expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'trial_expires_at',
  },
}, {
  tableName: 'tenants',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['tenant_key'],
    },
    {
      fields: ['status'],
    },
    {
      fields: ['created_at'],
    },
  ],
    });
  }
  return Tenant;
}

// Exporta função factory para lazy loading
module.exports = getTenantModel;
