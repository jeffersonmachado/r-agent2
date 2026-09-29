'use strict';

/**
 * Migration: ciclo de BUG auditável do Engineering Mission (missão 2026-09-29).
 *
 * DUAS tabelas, deliberadamente:
 *   - `engineering_bug_findings`  — o ESTADO corrente do finding (um registro por bug);
 *   - `engineering_bug_finding_events` — HISTÓRICO append-only (nunca sofre UPDATE).
 *
 * A separação é o que torna o ciclo auditável: `occurrences`/`recurrence_count` no estado corrente
 * respondem "quantas vezes"; o evento de cada ocorrência, cada evidência, cada transição de status e
 * cada regressão respondem "quando, por quem e com qual prova". Sem o histórico, um finding CLOSED
 * sem reprodução é indistinguível de um CLOSED honesto.
 *
 * Nenhuma tabela paralela de evidência é criada: as evidências são REFERÊNCIAS (`evidence_refs`)
 * para artefatos reais (relatórios de teste, runs de comando, invariantes) — a missão proíbe
 * duplicar infraestrutura que já existe.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_bug_findings', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      mission_id: { type: Sequelize.UUID, allowNull: true },
      mission_version: { type: Sequelize.INTEGER, allowNull: true },
      mission_spec_hash: { type: Sequelize.STRING(80), allowNull: true },
      task_id: { type: Sequelize.UUID, allowNull: true },

      source: { type: Sequelize.STRING(40), allowNull: false },
      category: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'UNKNOWN' },
      severity: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'MEDIUM' },
      severity_signals: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      advisory_severity: { type: Sequelize.STRING(16), allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'SUSPECTED' },

      title: { type: Sequelize.STRING(300), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      expected_behavior: { type: Sequelize.TEXT, allowNull: true },
      observed_behavior: { type: Sequelize.TEXT, allowNull: true },
      root_cause: { type: Sequelize.TEXT, allowNull: true },

      reproduction: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      reproduction_attempts: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      reproduction_steps: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      confirmation_basis: { type: Sequelize.STRING(48), allowNull: true },
      evidence_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },

      fingerprint: { type: Sequelize.STRING(80), allowNull: false },
      fingerprint_parts: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },

      affected_subsystems: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      affected_files: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      related_findings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      duplicate_of: { type: Sequelize.UUID, allowNull: true },

      occurrences: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      recurrence_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      first_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },

      fix_task_id: { type: Sequelize.UUID, allowNull: true },
      fix_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      regression_test_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      regression_runs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      resolved_at: { type: Sequelize.DATE, allowNull: true },

      self_modification: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      human_approval_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      auto_approval_forbidden: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      triage: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      blocked: { type: Sequelize.JSONB, allowNull: true },

      classification: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // O FK é RESTRICT de propósito: apagar uma missão NUNCA pode levar junto o histórico de bugs —
    // o rastro de um defeito é evidência de auditoria, não dado filho descartável.
    await queryInterface.addConstraint('engineering_bug_findings', {
      fields: ['mission_id'],
      type: 'foreign key',
      name: 'engineering_bug_findings_mission_fk',
      references: { table: 'engineering_missions', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    }).catch((err) => {
      // Idempotência: constraint já existente não é falha de migration.
      if (!/already exists|duplicate/i.test(err.message || '')) throw err;
    });

    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['fingerprint'], { name: 'engineering_bug_findings_fingerprint_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['mission_id'], { name: 'engineering_bug_findings_mission_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['status'], { name: 'engineering_bug_findings_status_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['severity'], { name: 'engineering_bug_findings_severity_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['self_modification'], { name: 'engineering_bug_findings_self_mod_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_findings', ['fix_task_id'], { name: 'engineering_bug_findings_fix_task_idx' });

    await createTableIfNotExists(queryInterface, 'engineering_bug_finding_events', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      finding_id: { type: Sequelize.UUID, allowNull: false },
      type: { type: Sequelize.STRING(32), allowNull: false },
      actor: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('engineering_bug_finding_events', {
      fields: ['finding_id'],
      type: 'foreign key',
      name: 'engineering_bug_finding_events_finding_fk',
      references: { table: 'engineering_bug_findings', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    }).catch((err) => {
      if (!/already exists|duplicate/i.test(err.message || '')) throw err;
    });

    await addIndexIfNotExists(queryInterface, 'engineering_bug_finding_events', ['finding_id'], { name: 'engineering_bug_finding_events_finding_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_bug_finding_events', ['type'], { name: 'engineering_bug_finding_events_type_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_bug_finding_events').catch(() => {});
    await queryInterface.dropTable('engineering_bug_findings').catch(() => {});
  },
};
