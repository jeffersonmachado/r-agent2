/**
 * Model AiProvider - registro global de providers de IA (built-ins + custom).
 *
 * Built-ins são sincronizados a partir de engine/aiProviderRegistry.js;
 * providers custom são criados/removidos pela interface de configuração.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AiProvider = null;

function getAiProviderModel() {
  if (!AiProvider) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AiProvider = sequelize.define('AiProvider', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      label: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      kind: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'openai-sdk | openai-compatible | anthropic',
      },
      base_url: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      default_model: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      models: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      validation_model: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      is_builtin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    }, {
      tableName: 'ai_providers',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['key'],
          name: 'ai_providers_key_unique',
        },
      ],
    });
  }
  return AiProvider;
}

module.exports = getAiProviderModel;
