/**
 * Model LroOutbox — fila TRANSACIONAL de publicação (estado + evento no mesmo commit).
 *
 * Criado por `api/db/migrations/20261030120000-create-lro-core.js`.
 * Mesmo padrão já usado em `api/services/outboundQueueService.js`: a tentativa é registrada ANTES
 * do efeito externo, com backoff e idempotência — nunca "publicou e depois gravou".
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LroOutbox = null;

function getLroOutboxModel() {
  if (!LroOutbox) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    LroOutbox = sequelize.define('LroOutbox', {
      id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      operation_id: { type: DataTypes.UUID, allowNull: true },
      event_id: { type: DataTypes.BIGINT, allowNull: true },
      topic: { type: DataTypes.STRING(120), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      available_at: { type: DataTypes.DATE, allowNull: false },
      published_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
    }, {
      tableName: 'lro_outbox',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    });
  }
  return LroOutbox;
}

module.exports = getLroOutboxModel;
