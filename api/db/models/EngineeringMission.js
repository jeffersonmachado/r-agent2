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
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_missions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['status'], name: 'engineering_missions_status_idx' },
        { fields: ['mission_type'], name: 'engineering_missions_type_idx' },
        { fields: ['risk'], name: 'engineering_missions_risk_idx' },
        { unique: true, fields: ['idempotency_key'], name: 'engineering_missions_idempotency_key_unique' },
      ],
    });
  }
  return EngineeringMission;
}

module.exports = getEngineeringMissionModel;
