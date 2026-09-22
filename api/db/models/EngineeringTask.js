'use strict';

/**
 * Model EngineeringTask — contrato de uma tarefa do Engineering Model Router V1.
 * Ver `docs/architecture/ENGINEERING_MODEL_ROUTER_ARCHITECTURE.md`.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringTask = null;

function getEngineeringTaskModel() {
  if (!EngineeringTask) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringTask = sequelize.define('EngineeringTask', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      title: { type: DataTypes.STRING, allowNull: false },
      objective: { type: DataTypes.TEXT, allowNull: true },
      task_type: { type: DataTypes.STRING, allowNull: false },
      risk: { type: DataTypes.STRING, allowNull: false },
      scope: { type: DataTypes.STRING, allowNull: false },
      required_capabilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      allowed_paths: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      forbidden_paths: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      // ER-V1-FINAL-003: nunca default true — autorização explícita e deliberada para
      // scope=REPOSITORY_WIDE operar com allowedPaths vazio (equivalente a ['**']).
      explicit_policy_authorization: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      acceptance_criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      test_commands: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      max_iterations: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'CREATED' },
      release_blocker: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      classification: { type: DataTypes.STRING, allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true, unique: true },
      classifier_result: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      routing_decision: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      locked_at: { type: DataTypes.DATE, allowNull: true },
      locked_by: { type: DataTypes.STRING, allowNull: true },
      last_error: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'engineering_tasks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['status'], name: 'engineering_tasks_status_idx' },
        { fields: ['task_type'], name: 'engineering_tasks_type_idx' },
        { fields: ['risk'], name: 'engineering_tasks_risk_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'engineering_tasks_idempotency_key_unique' },
      ],
    });
  }
  return EngineeringTask;
}

module.exports = getEngineeringTaskModel;
