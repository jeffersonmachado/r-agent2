'use strict';

/**
 * Model EngineeringOperation — ER-V1-SEAL-002 (Full Durable Resume).
 *
 * Um registro por EFEITO COLATERAL não idempotente de uma fase do Engineering Router (model
 * call, test run, review, regression, governance, promotion, post-promotion verify). Controle de
 * idempotência (nunca a evidência em si — isso continua em EngineeringTestRun/EngineeringReview/
 * EngineeringRegressionRun/promotion_evidence): decide se um resume após crash deve RESUME
 * (reusar resultado já persistido), RETRY (repetir), RECONCILE (checar evidência externa
 * real) ou FAIL_SAFE/MANUAL_REQUIRED (nunca operar às cegas sobre efeito colateral incerto).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringOperation = null;

function getEngineeringOperationModel() {
  if (!EngineeringOperation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringOperation = sequelize.define('EngineeringOperation', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      task_id: { type: DataTypes.UUID, allowNull: false },
      attempt_id: { type: DataTypes.UUID, allowNull: true },
      phase: { type: DataTypes.STRING, allowNull: false },
      idempotency_key: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      evidence_ref: { type: DataTypes.JSONB, allowNull: true },
      result_hash: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.JSONB, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_operations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['idempotency_key'], name: 'engineering_operations_idempotency_key_uidx', unique: true },
        { fields: ['task_id'], name: 'engineering_operations_task_idx' },
        { fields: ['attempt_id'], name: 'engineering_operations_attempt_idx' },
      ],
    });
  }
  return EngineeringOperation;
}

module.exports = getEngineeringOperationModel;
