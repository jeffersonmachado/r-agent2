/**
 * Model TenantContext - Contexto cognitivo do tenant (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantContext = null;

function getTenantContextModel() {
  if (!TenantContext) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    TenantContext = sequelize.define('TenantContext', {
      tenant_key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      ramo_atividade: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      objetivo: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      site_oficial: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      prioridade: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'HIGH',
      },
      escopo: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ['rag', 'chatbot', 'classificacao_intencao'],
      },
    }, {
      tableName: 'tenant_contexts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_contexts_tenant_key_idx' },
      ],
    });
  }

  return TenantContext;
}

module.exports = getTenantContextModel;

