'use strict';

/**
 * Migration: Engineering Mission Compiler + Enriquecimento (persistência durável).
 *
 * Três tabelas, nenhuma em memória:
 *   engineering_missions           — estado durável da missão (fase, aprovação, resume metadata)
 *   engineering_mission_versions   — histórico versionado e imutável de MissionSpec
 *   engineering_mission_approvals  — aprovação manual/automática vinculada a (versão, hash)
 *
 * Unicidades que são CONTRATO, não otimização:
 *   - missions.idempotency_key                     → criar a mesma missão duas vezes não duplica
 *   - versions(mission_id, version)                → duas versões divergentes são impossíveis
 *   - versions(mission_id, spec_hash)              → a mesma spec não é gravada duas vezes
 *   - approvals(mission_id, spec_version, state)   → duas aprovações do mesmo tipo não coexistem
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_missions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      title: { type: Sequelize.STRING, allowNull: false },
      original_mission: { type: Sequelize.TEXT, allowNull: false },
      original_mission_hash: { type: Sequelize.STRING, allowNull: false },
      enriched_mission: { type: Sequelize.TEXT, allowNull: true },
      objective: { type: Sequelize.TEXT, allowNull: true },
      mission_type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'INVESTIGATION' },
      repository: { type: Sequelize.STRING, allowNull: true },
      branch: { type: Sequelize.STRING, allowNull: true },
      scope: { type: Sequelize.STRING, allowNull: true },
      risk: { type: Sequelize.STRING, allowNull: false, defaultValue: 'MEDIUM' },
      enrichment_confidence: { type: Sequelize.FLOAT, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'CREATED' },
      current_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      current_spec_hash: { type: Sequelize.STRING, allowNull: true },
      approval_mode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'MANUAL' },
      approval_state: { type: Sequelize.STRING, allowNull: true },
      auto_approval_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      constraints: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      context_sources: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      subsystems: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      enrichment: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      preview: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      resume_metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      failure: { type: Sequelize.JSONB, allowNull: true },
      parent_mission_id: { type: Sequelize.UUID, allowNull: true },
      linked_task_id: { type: Sequelize.UUID, allowNull: true },
      linked_task_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      iteration: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      classification: { type: Sequelize.STRING, allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      locked_at: { type: Sequelize.DATE, allowNull: true },
      locked_by: { type: Sequelize.STRING, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'engineering_missions', ['idempotency_key'], { unique: true, name: 'engineering_missions_idempotency_key_unique' });
    await addIndexIfNotExists(queryInterface, 'engineering_missions', ['status'], { name: 'engineering_missions_status_idx' });

    await createTableIfNotExists(queryInterface, 'engineering_mission_versions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      mission_id: { type: Sequelize.UUID, allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false },
      original_mission: { type: Sequelize.TEXT, allowNull: false },
      spec: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      spec_hash: { type: Sequelize.STRING, allowNull: false },
      materiality: { type: Sequelize.STRING, allowNull: false, defaultValue: 'MATERIAL' },
      materiality_reasons: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      enrichment: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      diff: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      event: { type: Sequelize.STRING, allowNull: false, defaultValue: 'ENRICHED' },
      note: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'engineering_mission_versions', ['mission_id', 'version'], { unique: true, name: 'engineering_mission_versions_version_unique' });
    await addIndexIfNotExists(queryInterface, 'engineering_mission_versions', ['mission_id', 'spec_hash'], { unique: true, name: 'engineering_mission_versions_spec_hash_unique' });

    await createTableIfNotExists(queryInterface, 'engineering_mission_approvals', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      mission_id: { type: Sequelize.UUID, allowNull: false },
      spec_version: { type: Sequelize.INTEGER, allowNull: false },
      spec_hash: { type: Sequelize.STRING, allowNull: false },
      state: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PENDING' },
      mode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'MANUAL' },
      policy_id: { type: Sequelize.STRING, allowNull: true },
      policy_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      rules_evaluated: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      blockers: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      enrichment_diff: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      history: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      decision_reason: { type: Sequelize.TEXT, allowNull: true },
      actor: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    // UMA decisão por (mission, versão). A unicidade por `state` permitia duas linhas para a
    // mesma versão (PENDING + APPROVED) e quebrava ao marcá-las SUPERSEDED — defeito real. A
    // sucessão de decisões é registrada em `history` (append-only), não em linhas duplicadas.
    await addIndexIfNotExists(queryInterface, 'engineering_mission_approvals', ['mission_id', 'spec_version'], { unique: true, name: 'engineering_mission_approvals_version_unique' });
    await addIndexIfNotExists(queryInterface, 'engineering_mission_approvals', ['idempotency_key'], { unique: true, name: 'engineering_mission_approvals_idempotency_key_unique' });

    // Política de autoaprovação da instalação (singleton `default`). Durável e auditável: governa
    // execução autônoma, então não pode viver em memória nem em arquivo de apresentação.
    await createTableIfNotExists(queryInterface, 'engineering_mission_settings', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true, defaultValue: 'default' },
      auto_approval_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      updated_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_mission_settings').catch(() => {});
    await queryInterface.dropTable('engineering_mission_approvals').catch(() => {});
    await queryInterface.dropTable('engineering_mission_versions').catch(() => {});
    await queryInterface.dropTable('engineering_missions').catch(() => {});
  },
};
