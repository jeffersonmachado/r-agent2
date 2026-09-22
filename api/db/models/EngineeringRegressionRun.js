'use strict';

/**
 * Model EngineeringRegressionRun — ER-V1-FINAL-006 (Real Regression).
 *
 * Um registro por EXECUÇÃO REAL do plano de regressão (depois de REVIEW aprovar, proporcional
 * ao risco declarado) — distinto de EngineeringTestRun (um registro por comando da fase
 * TESTING original). Nunca "evidence revalidation": commands/exit_codes refletem comandos
 * REALMENTE executados nesta chamada, amarrados ao source_fingerprint da working tree no
 * momento da execução.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringRegressionRun = null;

function getEngineeringRegressionRunModel() {
  if (!EngineeringRegressionRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringRegressionRun = sequelize.define('EngineeringRegressionRun', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      task_id: { type: DataTypes.UUID, allowNull: false },
      attempt_id: { type: DataTypes.UUID, allowNull: false },
      plan_tier: { type: DataTypes.STRING, allowNull: false },
      commands: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      exit_codes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      source_fingerprint: { type: DataTypes.STRING, allowNull: true },
      result: { type: DataTypes.STRING, allowNull: false },
      evidence_refs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_regression_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['attempt_id'], name: 'engineering_regression_runs_attempt_idx' },
        { fields: ['task_id'], name: 'engineering_regression_runs_task_idx' },
      ],
    });
  }
  return EngineeringRegressionRun;
}

module.exports = getEngineeringRegressionRunModel;
