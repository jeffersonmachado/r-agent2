'use strict';

/**
 * Model EngineeringMissionReview — resultado persistido de Meta Review (§23) e Adversarial
 * Review (§24) por missão/versão.
 *
 * Guardar os findings é o que transforma "revisão" em evidência: sem isso, um BLOCKER encontrado
 * na revisão desaparece com o processo e a missão pode ser apresentada como concluída.
 *
 * O modelo NÃO diz o que é GREEN — ele registra o que foi observado. A autoridade continua sendo
 * a composição de gates verificáveis (ver `missionOrchestratorService.refreshMissionState`, que
 * recusa GREEN quando existe review bloqueante da versão corrente).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMissionReview = null;

function getEngineeringMissionReviewModel() {
  if (!EngineeringMissionReview) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMissionReview = sequelize.define('EngineeringMissionReview', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      mission_id: { type: DataTypes.UUID, allowNull: false },
      mission_version: { type: DataTypes.INTEGER, allowNull: false },
      spec_hash: { type: DataTypes.STRING, allowNull: true },
      kind: { type: DataTypes.STRING, allowNull: false, defaultValue: 'META' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INCOMPLETE' },
      blocks_green: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      counts: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      findings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      engine_version: { type: DataTypes.STRING, allowNull: false },
      actor: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true, unique: true },
    }, {
      tableName: 'engineering_mission_reviews',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['mission_id', 'mission_version', 'kind'], name: 'engineering_mission_reviews_lookup_idx' },
        { fields: ['blocks_green'], name: 'engineering_mission_reviews_blocks_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'engineering_mission_reviews_idempotency_key_unique' },
      ],
    });
  }
  return EngineeringMissionReview;
}

module.exports = getEngineeringMissionReviewModel;
