'use strict';

/**
 * Model EngineeringAttempt — uma tentativa do loop RED→FIX de uma EngineeringTask.
 * Tentativas pertencem à mesma task (retry != nova task); `attempt_number` é sequencial.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringAttempt = null;

function getEngineeringAttemptModel() {
  if (!EngineeringAttempt) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringAttempt = sequelize.define('EngineeringAttempt', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      task_id: { type: DataTypes.UUID, allowNull: false },
      attempt_number: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PENDING' },
      coder_provider: { type: DataTypes.STRING, allowNull: true },
      coder_model: { type: DataTypes.STRING, allowNull: true },
      routing_reason_codes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      patch_diff: { type: DataTypes.TEXT, allowNull: true },
      patch_validation: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      context_summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      failure_bundle: { type: DataTypes.JSONB, allowNull: true },
      workspace_path: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.JSONB, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_attempts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['task_id', 'attempt_number'], name: 'engineering_attempts_task_attempt_idx', unique: true },
        { fields: ['status'], name: 'engineering_attempts_status_idx' },
      ],
    });
  }
  return EngineeringAttempt;
}

module.exports = getEngineeringAttemptModel;
