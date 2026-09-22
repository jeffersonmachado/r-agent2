/**
 * Migration: cria engineering_regression_runs.
 *
 * ER-V1-FINAL-006 — Real Regression: cada execução real do REGRESSION stage (depois de REVIEW
 * aprovar, proporcional ao risco declarado) precisa de um registro dedicado — plano, comandos
 * de fato executados, exitCodes reais, fingerprint da working tree no momento da execução.
 * Distinto de EngineeringTestRun (um registro por comando da fase TESTING original) — aqui é
 * um registro por EXECUÇÃO DE PLANO de regressão, agregando múltiplos comandos.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_regression_runs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      task_id: { type: Sequelize.UUID, allowNull: false },
      attempt_id: { type: Sequelize.UUID, allowNull: false },
      plan_tier: { type: Sequelize.STRING, allowNull: false },
      commands: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      exit_codes: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      source_fingerprint: { type: Sequelize.STRING, allowNull: true },
      result: { type: Sequelize.STRING, allowNull: false },
      evidence_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'engineering_regression_runs', ['attempt_id'], { name: 'engineering_regression_runs_attempt_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_regression_runs', ['task_id'], { name: 'engineering_regression_runs_task_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_regression_runs').catch(() => {});
  },
};
