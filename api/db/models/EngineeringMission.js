'use strict';

/**
 * Model EngineeringMission — objetivo de engenharia completo (MissionSpec + execução).
 *
 * Nível ACIMA da EngineeringTask: a task é a unidade de execução do Engineer Model Router
 * (patch/teste/review/regressão); a mission é o objetivo persistente que pode gerar uma ou mais
 * tasks. `original_mission` é a intenção literal do usuário e NUNCA é reescrita (a autoridade que
 * garante isso é `assertOriginalMissionImmutable`, mas a coluna existe separada justamente para
 * que a auditoria externa possa lê-la sem depender do JSON da spec).
 *
 * Persistência real via Sequelize — sem fallback em memória (convenção: `persistence_required`).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringMission = null;

function getEngineeringMissionModel() {
  if (!EngineeringMission) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringMission = sequelize.define('EngineeringMission', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      title: { type: DataTypes.STRING, allowNull: false },
      original_mission: { type: DataTypes.TEXT, allowNull: false },
      original_mission_hash: { type: DataTypes.STRING, allowNull: false },
      enriched_mission: { type: DataTypes.TEXT, allowNull: true },
      objective: { type: DataTypes.TEXT, allowNull: true },
      mission_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INVESTIGATION' },
      repository: { type: DataTypes.STRING, allowNull: true },
      branch: { type: DataTypes.STRING, allowNull: true },
      scope: { type: DataTypes.STRING, allowNull: true },
      risk: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MEDIUM' },
      enrichment_confidence: { type: DataTypes.FLOAT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'CREATED' },
      current_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      current_spec_hash: { type: DataTypes.STRING, allowNull: true },
      approval_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MANUAL' },
      approval_state: { type: DataTypes.STRING, allowNull: true },
      auto_approval_policy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      constraints: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      context_sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      subsystems: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      // Enriquecimento e preview persistidos MESMO quando autoaprovado (§10): automação nunca é
      // execução invisível — o diff e sua justificativa ficam disponíveis para inspeção posterior.
      enrichment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      preview: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // Retomada: o que fazer quando o processo morre no meio de uma fase (durable resume).
      resume_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      failure: { type: DataTypes.JSONB, allowNull: true },
      parent_mission_id: { type: DataTypes.UUID, allowNull: true },
      linked_task_id: { type: DataTypes.UUID, allowNull: true },
      linked_task_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      iteration: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      classification: { type: DataTypes.STRING, allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true, unique: true },
      locked_at: { type: DataTypes.DATE, allowNull: true },
      locked_by: { type: DataTypes.STRING, allowNull: true },
      // LEASE DISTRIBUÍDO (§30–§32): identidade de instância + TTL + heartbeat + fencing.
      // `locked_by` continua existindo como registro local legado; a autoridade de takeover é o
      // lease (expiração real) e a de escrita é o par (lease_token, lease_fence).
      lease_worker_instance_id: { type: DataTypes.STRING, allowNull: true },
      lease_worker_type: { type: DataTypes.STRING, allowNull: true },
      lease_host: { type: DataTypes.STRING, allowNull: true },
      lease_token: { type: DataTypes.STRING, allowNull: true },
      lease_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lease_acquired_at: { type: DataTypes.DATE, allowNull: true },
      lease_expires_at: { type: DataTypes.DATE, allowNull: true },
      lease_heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      // PROGRESSO SIGNIFICATIVO — separado de LIVENESS de propósito.
      // `lease_heartbeat_at` prova que o worker está VIVO; `last_progress_at`
      // prova que está AVANÇANDO. Sem esta separação só resta o TEMPO DECORRIDO
      // como sinal, e é exatamente assim que uma task saudável (lenta) acaba
      // derrubada por um timeout fixo — o defeito que esta arquitetura elimina.
      last_progress_at: { type: DataTypes.DATE, allowNull: true },
      last_progress_signal: { type: DataTypes.STRING(48), allowNull: true },
      progress_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },

      // ---------------------------------------------------------------- MISSION SOURCE AUTHORITY
      // A missão NÃO executa sobre a `main`. `mission_source_ref` é a ORIGEM (de onde a branch da
      // missão derivou) e `mission_integration_branch` é a FONTE real de execução
      // (`engineering/missions/<missionId>`). `mission_current_commit` é a autoridade de código da
      // missão: toda task declara de qual commit dela nasceu, todo fix integra nela, e o resume usa
      // ELA — nunca o HEAD da main. Sem estas colunas, o fix do Bug Loop ficava numa branch
      // candidate isolada e a task seguinte da missão voltava a nascer da main, "ressuscitando" o
      // bug que já tinha sido corrigido.
      mission_source_ref: { type: DataTypes.STRING(255), allowNull: true },
      mission_base_commit: { type: DataTypes.STRING(64), allowNull: true },
      mission_integration_branch: { type: DataTypes.STRING(255), allowNull: true },
      mission_current_commit: { type: DataTypes.STRING(64), allowNull: true },
      mission_source_state: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'PENDING' },
      // Fence do AVANÇO DA FONTE. O `lease_fence` protege a posse da missão; este protege o commit
      // dela: dois integration concorrentes não podem avançar a fonte com a mesma leitura.
      mission_source_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      mission_workspace_id: { type: DataTypes.STRING(120), allowNull: true },
    }, {
      tableName: 'engineering_missions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['status'], name: 'engineering_missions_status_idx' },
        { fields: ['mission_type'], name: 'engineering_missions_type_idx' },
        { fields: ['risk'], name: 'engineering_missions_risk_idx' },
        { fields: ['lease_expires_at'], name: 'engineering_missions_lease_expires_idx' },
        { fields: ['lease_worker_instance_id'], name: 'engineering_missions_lease_worker_idx' },
        { fields: ['mission_current_commit'], name: 'engineering_missions_current_commit_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'engineering_missions_idempotency_key_unique' },
      ],
    });
  }
  return EngineeringMission;
}

module.exports = getEngineeringMissionModel;
