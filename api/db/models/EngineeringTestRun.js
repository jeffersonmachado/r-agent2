'use strict';

/**
 * Model EngineeringTestRun — execução determinística de um comando de teste para uma
 * EngineeringAttempt. A autoridade de PASS/FAIL é sempre o exitCode real, nunca o LLM.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringTestRun = null;

function getEngineeringTestRunModel() {
  if (!EngineeringTestRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringTestRun = sequelize.define('EngineeringTestRun', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      attempt_id: { type: DataTypes.UUID, allowNull: false },
      command: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'RUNNING' },
      exit_code: { type: DataTypes.INTEGER, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER, allowNull: true },
      stdout_ref: { type: DataTypes.STRING, allowNull: true },
      stderr_ref: { type: DataTypes.STRING, allowNull: true },
      stdout_excerpt: { type: DataTypes.TEXT, allowNull: true },
      stderr_excerpt: { type: DataTypes.TEXT, allowNull: true },
      artifacts: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_test_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['attempt_id'], name: 'engineering_test_runs_attempt_idx' },
        { fields: ['status'], name: 'engineering_test_runs_status_idx' },
      ],
    });
  }
  return EngineeringTestRun;
}

module.exports = getEngineeringTestRunModel;
