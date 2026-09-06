'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

/**
 * Migration: Vertical ML models
 *
 * Persiste os modelos de ML treinados por tenant (ex.: fitness_churn).
 * Pesos, features, métricas de treino e versionamento ficam em JSONB para
 * auditoria e reprodutibilidade. Nunca há fallback heurístico: sem modelo
 * treinado, o scoring falha fechado (AI_ML_REQUIRED).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'vertical_ml_models', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      model_type: { type: Sequelize.STRING, allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      algorithm: { type: Sequelize.STRING, allowNull: false, defaultValue: 'logistic_regression' },
      weights: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metrics: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      trained_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_ml_models', ['tenant_key', 'model_type', 'status'], {
      name: 'vmm_tenant_type_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_ml_models', ['tenant_key', 'model_type', 'version'], {
      name: 'vmm_tenant_type_version_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vertical_ml_models');
  },
};
