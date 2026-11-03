/**
 * Model LroOperation — entidade AUTORITATIVA de uma operação longa (LRO).
 *
 * Criado por `api/db/migrations/20261030120000-create-lro-core.js`.
 * Máquina de estados e regras puras: `api/services/lro/lroStateMachine.js` (não duplicar aqui).
 *
 * `outcome` é separado de `status` de propósito: `COMPLETED` responde "terminou", `outcome`
 * responde "deu GO?" — terminar não é passar (mandato LRO §4).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LroOperation = null;

function getLroOperationModel() {
  if (!LroOperation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    LroOperation = sequelize.define('LroOperation', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      owner_actor_id: { type: DataTypes.STRING(120), allowNull: true },
      operation_type: { type: DataTypes.STRING(80), allowNull: false },
      visibility_class: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'DEVELOPMENT' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'CREATED' },
      phase: { type: DataTypes.STRING(80), allowNull: true },
      progress_current: { type: DataTypes.INTEGER, allowNull: true },
      progress_total: { type: DataTypes.INTEGER, allowNull: true },
      progress_unit: { type: DataTypes.STRING(24), allowNull: true },
      progress_revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      message_code: { type: DataTypes.STRING(80), allowNull: true },
      result_ref: { type: DataTypes.STRING(512), allowNull: true },
      outcome: { type: DataTypes.STRING(20), allowNull: true },
      error_code: { type: DataTypes.STRING(80), allowNull: true },
      feedback_request_id: { type: DataTypes.STRING(80), allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      checkpoint_ref: { type: DataTypes.STRING(512), allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lease_owner: { type: DataTypes.STRING(160), allowNull: true },
      lease_expires_at: { type: DataTypes.DATE, allowNull: true },
      fencing_token: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      correlation_id: { type: DataTypes.STRING(80), allowNull: true },
      idempotency_key: { type: DataTypes.STRING(200), allowNull: true },
      retention_policy: { type: DataTypes.STRING(40), allowNull: true },
    }, {
      tableName: 'lro_operations',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  }
  return LroOperation;
}

module.exports = getLroOperationModel;
