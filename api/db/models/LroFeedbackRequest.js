/**
 * Model LroFeedbackRequest — pedido de decisão humana para uma operação longa.
 *
 * Criado por `api/db/migrations/20261030140000-create-lro-feedback.js`.
 * `deadline_at` existe porque silêncio NUNCA é aprovação: vencido o prazo, o pedido vira `EXPIRED`
 * e a operação NÃO avança sozinha.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Model = null;

function getLroFeedbackRequestModel() {
  if (!Model) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }
    Model = sequelize.define('LroFeedbackRequest', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      operation_id: { type: DataTypes.UUID, allowNull: false },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      requested_by: { type: DataTypes.STRING(120), allowNull: true },
      assignee_actor_id: { type: DataTypes.STRING(120), allowNull: true },
      assignee_role: { type: DataTypes.STRING(80), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
      options: { type: DataTypes.JSONB, allowNull: true },
      response_schema: { type: DataTypes.JSONB, allowNull: true },
      operation_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      deadline_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'lro_feedback_requests',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  }
  return Model;
}

module.exports = getLroFeedbackRequestModel;
