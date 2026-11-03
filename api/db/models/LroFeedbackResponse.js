/**
 * Model LroFeedbackResponse — resposta auditada a um pedido de decisão.
 *
 * Criado por `api/db/migrations/20261030140000-create-lro-feedback.js`.
 * `idempotency_key` única por solicitação: reenvio devolve a resposta existente sem repetir efeito.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Model = null;

function getLroFeedbackResponseModel() {
  if (!Model) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }
    Model = sequelize.define('LroFeedbackResponse', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      request_id: { type: DataTypes.UUID, allowNull: false },
      operation_id: { type: DataTypes.UUID, allowNull: false },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      actor_id: { type: DataTypes.STRING(120), allowNull: true },
      decision: { type: DataTypes.STRING(40), allowNull: false },
      option_id: { type: DataTypes.STRING(80), allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: true },
      operation_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      idempotency_key: { type: DataTypes.STRING(200), allowNull: false },
    }, {
      tableName: 'lro_feedback_responses',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    });
  }
  return Model;
}

module.exports = getLroFeedbackResponseModel;
