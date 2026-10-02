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
      // Lease + fencing (missão V2): `locked_at`/`locked_by` são apenas temporais e não impedem um
      // worker ANTIGO sobrescrever o estado produzido pelo novo depois de um takeover. O fence é
      // monotônico e o token é do dono: qualquer escrita sensível passa por CAS.
      lease_token: { type: DataTypes.UUID, allowNull: true },
      lease_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lease_worker_instance_id: { type: DataTypes.STRING(160), allowNull: true },
      lease_host: { type: DataTypes.STRING(160), allowNull: true },
      lease_acquired_at: { type: DataTypes.DATE, allowNull: true },
      lease_expires_at: { type: DataTypes.DATE, allowNull: true },
      lease_heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      // PROGRESSO SIGNIFICATIVO — separado de LIVENESS (ver EngineeringMission).
      last_progress_at: { type: DataTypes.DATE, allowNull: true },
      last_progress_signal: { type: DataTypes.STRING(48), allowNull: true },
      progress_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Vínculo verificável com a versão da MissionSpec que originou esta task (missão V2,
      // §22/§23 — stale mission spec). Sem estes campos, uma task criada para a v1 seguia
      // executando fases materiais (com efeito real no git) depois da v2 aprovada, sem que
      // nenhuma fase pudesse detectar o contrato obsoleto.
      mission_id: { type: DataTypes.UUID, allowNull: true },
      mission_version: { type: DataTypes.INTEGER, allowNull: true },
      mission_spec_hash: { type: DataTypes.STRING(80), allowNull: true },
      mission_spec_state: { type: DataTypes.STRING(20), allowNull: true },
      superseded_by_task_id: { type: DataTypes.UUID, allowNull: true },
      mission_spec_checked_at: { type: DataTypes.DATE, allowNull: true },
      // ---------------------------------------------------------------- HERANÇA DE FONTE
      // De QUAL commit da fonte da missão esta task nasceu. É a autoridade que substitui o
      // `git rev-parse HEAD` do ROOT em `patchApplyService.createWorkspace`: a tentativa é
      // materializada a partir DESTE commit, então a task enxerga os patches que as tasks
      // anteriores da mesma missão já integraram. `source_mission_fence` registra sob qual fence da
      // fonte a task foi criada — uma task nascida sob fence antigo é detectável como obsoleta.
      source_commit: { type: DataTypes.STRING(64), allowNull: true },
      source_ref: { type: DataTypes.STRING(255), allowNull: true },
      source_mission_fence: { type: DataTypes.INTEGER, allowNull: true },
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
        { fields: ['lease_expires_at'], name: 'engineering_tasks_lease_expires_idx' },
        { fields: ['lease_worker_instance_id'], name: 'engineering_tasks_lease_worker_idx' },
        { fields: ['mission_id'], name: 'engineering_tasks_mission_id_idx' },
        { fields: ['mission_spec_state'], name: 'engineering_tasks_mission_spec_state_idx' },
        { fields: ['source_commit'], name: 'engineering_tasks_source_commit_idx' },
      ],
    });
  }
  return EngineeringTask;
}

module.exports = getEngineeringTaskModel;
