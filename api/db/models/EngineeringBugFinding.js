'use strict';

/**
 * Model EngineeringBugFinding — estado corrente de UM bug detectado pelo RAP.
 *
 * O modelo NÃO decide nada: ele persiste o que a triagem/reprodução/correção/regressão observaram.
 * As regras (quando confirmar, quando declarar FIXED, quando exigir aprovação humana) vivem em
 * `engine/engineeringMission/bugFinding/` — uma única implementação, consumida também pelo gate.
 *
 * Índice NOT em `fingerprint` único de propósito: a identidade sozinha não é unicidade global —
 * o mesmo defeito pode ser rastreado em missões distintas; a deduplicação é aplicada pelo serviço
 * (mesmo fingerprint + mesmo escopo de missão + não terminal ⇒ incrementa `occurrences`).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringBugFinding = null;

function getEngineeringBugFindingModel() {
  if (!EngineeringBugFinding) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringBugFinding = sequelize.define('EngineeringBugFinding', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      mission_id: { type: DataTypes.UUID, allowNull: true },
      mission_version: { type: DataTypes.INTEGER, allowNull: true },
      mission_spec_hash: { type: DataTypes.STRING(80), allowNull: true },
      task_id: { type: DataTypes.UUID, allowNull: true },

      source: { type: DataTypes.STRING(40), allowNull: false },
      category: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'UNKNOWN' },
      severity: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'MEDIUM' },
      severity_signals: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      advisory_severity: { type: DataTypes.STRING(16), allowNull: true },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'SUSPECTED' },

      title: { type: DataTypes.STRING(300), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      expected_behavior: { type: DataTypes.TEXT, allowNull: true },
      observed_behavior: { type: DataTypes.TEXT, allowNull: true },
      root_cause: { type: DataTypes.TEXT, allowNull: true },

      reproduction: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      reproduction_attempts: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      reproduction_steps: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      confirmation_basis: { type: DataTypes.STRING(48), allowNull: true },
      evidence_refs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

      fingerprint: { type: DataTypes.STRING(80), allowNull: false },
      fingerprint_parts: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

      affected_subsystems: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      affected_files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      related_findings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      duplicate_of: { type: DataTypes.UUID, allowNull: true },

      occurrences: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      recurrence_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      first_seen_at: { type: DataTypes.DATE, allowNull: false },
      last_seen_at: { type: DataTypes.DATE, allowNull: false },

      fix_task_id: { type: DataTypes.UUID, allowNull: true },
      fix_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      regression_test_refs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      regression_runs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      resolved_at: { type: DataTypes.DATE, allowNull: true },

      self_modification: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      human_approval_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      auto_approval_forbidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      triage: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      blocked: { type: DataTypes.JSONB, allowNull: true },

      classification: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },

      // CAS OTIMISTA de transição (§ concorrência de estado). Toda mudança de status incrementa
      // `version` sob condição da versão lida — duas transições concorrentes não podem vencer.
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // LINHAGEM / proteção contra explosão recursiva (finding que gera finding que falha…).
      parent_finding_id: { type: DataTypes.UUID, allowNull: true },
      origin: { type: DataTypes.STRING(40), allowNull: true },
      depth: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // POSSE DURÁVEL do worker do laço: lease + fence monotônico + heartbeat.
      lease_token: { type: DataTypes.UUID, allowNull: true },
      lease_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lease_worker_instance_id: { type: DataTypes.STRING(160), allowNull: true },
      lease_acquired_at: { type: DataTypes.DATE, allowNull: true },
      lease_expires_at: { type: DataTypes.DATE, allowNull: true },
      lease_heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      last_progress_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'engineering_bug_findings',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['fingerprint'], name: 'engineering_bug_findings_fingerprint_idx' },
        { fields: ['mission_id'], name: 'engineering_bug_findings_mission_idx' },
        { fields: ['status'], name: 'engineering_bug_findings_status_idx' },
        { fields: ['severity'], name: 'engineering_bug_findings_severity_idx' },
        { fields: ['self_modification'], name: 'engineering_bug_findings_self_mod_idx' },
        { fields: ['fix_task_id'], name: 'engineering_bug_findings_fix_task_idx' },
        { fields: ['lease_expires_at'], name: 'engineering_bug_findings_lease_expires_idx' },
        { fields: ['lease_worker_instance_id'], name: 'engineering_bug_findings_lease_worker_idx' },
        { fields: ['parent_finding_id'], name: 'engineering_bug_findings_parent_idx' },
      ],
    });
  }
  return EngineeringBugFinding;
}

module.exports = getEngineeringBugFindingModel;
