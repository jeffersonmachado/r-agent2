/**
 * Model LroEvent — log APPEND-ONLY de eventos de uma operação longa.
 *
 * Criado por `api/db/migrations/20261030120000-create-lro-core.js`.
 * `seq` é monotônico POR operação (índice único `operation_id, seq`) e é o cursor que o SSE usa
 * como `Last-Event-ID`: reconectar com cursor antigo devolve só o que faltou.
 *
 * Sem `update`/`delete` na aplicação: corrigir evento é emitir outro evento, nunca reescrever.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LroEvent = null;

function getLroEventModel() {
  if (!LroEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    LroEvent = sequelize.define('LroEvent', {
      id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      operation_id: { type: DataTypes.UUID, allowNull: false },
      seq: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.STRING(80), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      actor_id: { type: DataTypes.STRING(120), allowNull: true },
    }, {
      tableName: 'lro_events',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    });
  }
  return LroEvent;
}

module.exports = getLroEventModel;
