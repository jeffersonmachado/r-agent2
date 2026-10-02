'use strict';

/**
 * Model EngineeringMissionIntegration — trilha APPEND-ONLY de cada integração de candidate na
 * fonte de uma Engineering Mission.
 *
 * POR QUE UMA TABELA (e não um campo JSON na missão): a integração é o ponto em que o trabalho de
 * uma task passa a valer para as próximas. Se esse passo não deixar rastro por si, a única
 * evidência de que "a task B viu o patch da task A" seria o hash final — que não distingue
 * "integrou" de "nunca integrou e o hash mudou por outro motivo". A trilha é o que permite
 * responder, para qualquer commit da fonte: QUEM o produziu, sobre qual base, sob qual fence,
 * autorizado por quais evidências.
 *
 * `integration_key` (único) é derivado de `(missionId, taskId, candidateCommit)` — é a chave de
 * IDEMPOTÊNCIA da integração. O processo pode morrer entre criar o commit na fonte e persistir o
 * novo commit corrente; na retomada, a mesma tríade é reconhecida e o patch NÃO é reaplicado. A
 * unicidade vive no BANCO (índice único), não numa checagem em código sujeita a TOCTOU.
 *
 * Persistência real via Sequelize — sem fallback em memória (convenção: `persistence_required`).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMissionIntegration = null;

function getEngineeringMissionIntegrationModel() {
  if (!EngineeringMissionIntegration) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMissionIntegration = sequelize.define('EngineeringMissionIntegration', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      mission_id: { type: DataTypes.UUID, allowNull: false },
      task_id: { type: DataTypes.UUID, allowNull: true },
      finding_id: { type: DataTypes.UUID, allowNull: true },

      // TASK_CANDIDATE | BUG_FIX_CANDIDATE — o bug fix usa o MESMO caminho, não um privilegiado.
      integration_type: { type: DataTypes.STRING(32), allowNull: false },
      // INTEGRATED | ALREADY_INTEGRATED | PRECONDITION_FAILED | STALE_CANDIDATE |
      // CONCURRENT_SOURCE_UPDATE | CONFLICT | INTEGRITY_FAILED
      integration_result: { type: DataTypes.STRING(32), allowNull: false },

      candidate_commit: { type: DataTypes.STRING(64), allowNull: false },
      candidate_base_commit: { type: DataTypes.STRING(64), allowNull: true },
      mission_commit_before: { type: DataTypes.STRING(64), allowNull: true },
      mission_commit_after: { type: DataTypes.STRING(64), allowNull: true },

      integration_branch: { type: DataTypes.STRING(255), allowNull: true },
      integration_key: { type: DataTypes.STRING(255), allowNull: false },
      // Fence da fonte no momento da integração: prova que o avanço ocorreu sob posse vigente.
      source_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Evidências que AUTORIZARAM a integração. "O coder terminou" não é uma delas.
      tests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      review: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      regression: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      conflict: { type: DataTypes.JSONB, allowNull: true },
      error: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'engineering_mission_integrations',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['integration_key'], name: 'engineering_mission_integrations_key_uidx' },
        { fields: ['mission_id', 'created_at'], name: 'engineering_mission_integrations_mission_idx' },
        { fields: ['task_id'], name: 'engineering_mission_integrations_task_idx' },
        { fields: ['integration_result'], name: 'engineering_mission_integrations_result_idx' },
      ],
    });
  }
  return EngineeringMissionIntegration;
}

module.exports = getEngineeringMissionIntegrationModel;
