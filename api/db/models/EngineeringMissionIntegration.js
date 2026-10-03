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
      //
      // Opcional desde 2026-10-03: a linha nasce como INTENT (PREPARED) antes de tocar na ref git,
      // e nessa fase ainda NÃO existe desfecho a declarar. Exigi-lo aqui era o que empurrava a
      // gravação do registro para o FIM da operação — abrindo a janela de crash git↔DB.
      integration_result: { type: DataTypes.STRING(32), allowNull: true },

      // PREPARED | GIT_APPLIED | DB_APPLIED | COMMITTED | CONFLICT | ABORTED | RECOVERY_REQUIRED
      // É a fase DURÁVEL da integração: persistida antes do `git update-ref`, ela é o que permite
      // reconciliar qualquer morte de processo sem reaplicar efeito. Linhas anteriores a esta
      // migração são pós-fato e valem como COMMITTED (default da coluna).
      integration_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'COMMITTED' },

      // Carimbos por fase: tornam a janela de crash observável (não há como inferir "quando" de
      // um estado, e sem isso um intent travado é indistinguível de um intent recém-criado).
      git_applied_at: { type: DataTypes.DATE, allowNull: true },
      db_applied_at: { type: DataTypes.DATE, allowNull: true },
      committed_at: { type: DataTypes.DATE, allowNull: true },

      // Contexto do intent: instância que preparou o efeito, commit/fence esperados no momento da
      // preparação. `expected_mission_commit` é o CAS esperado — sem ele a reconciliação teria de
      // adivinhar de onde a branch partiu.
      worker_instance_id: { type: DataTypes.STRING(64), allowNull: true },
      expected_mission_commit: { type: DataTypes.STRING(64), allowNull: true },
      expected_fence: { type: DataTypes.INTEGER, allowNull: true },

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
        // Varredura de boot por intents NÃO terminais (PREPARED/GIT_APPLIED/DB_APPLIED/RECOVERY_REQUIRED).
        { fields: ['integration_status'], name: 'engineering_mission_integrations_status_idx' },
      ],
    });
  }
  return EngineeringMissionIntegration;
}

module.exports = getEngineeringMissionIntegrationModel;
