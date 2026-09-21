'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_tasks', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      title: { type: Sequelize.STRING, allowNull: false },
      objective: { type: Sequelize.TEXT, allowNull: true },
      task_type: { type: Sequelize.STRING, allowNull: false },
      risk: { type: Sequelize.STRING, allowNull: false },
      scope: { type: Sequelize.STRING, allowNull: false },
      required_capabilities: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      allowed_paths: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      forbidden_paths: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      acceptance_criteria: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      test_commands: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      max_iterations: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'CREATED' },
      release_blocker: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      classification: { type: Sequelize.STRING, allowNull: false, defaultValue: 'DEVELOPMENT' },
      created_by: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      classifier_result: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      routing_decision: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      locked_at: { type: Sequelize.DATE, allowNull: true },
      locked_by: { type: Sequelize.STRING, allowNull: true },
      last_error: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'engineering_attempts', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      task_id: { type: Sequelize.UUID, allowNull: false },
      attempt_number: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PENDING' },
      coder_provider: { type: Sequelize.STRING, allowNull: true },
      coder_model: { type: Sequelize.STRING, allowNull: true },
      routing_reason_codes: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      patch_diff: { type: Sequelize.TEXT, allowNull: true },
      patch_validation: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      context_summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      failure_bundle: { type: Sequelize.JSONB, allowNull: true },
      workspace_path: { type: Sequelize.STRING, allowNull: true },
      error: { type: Sequelize.JSONB, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'engineering_test_runs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      attempt_id: { type: Sequelize.UUID, allowNull: false },
      command: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'RUNNING' },
      exit_code: { type: Sequelize.INTEGER, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      stdout_ref: { type: Sequelize.STRING, allowNull: true },
      stderr_ref: { type: Sequelize.STRING, allowNull: true },
      stdout_excerpt: { type: Sequelize.TEXT, allowNull: true },
      stderr_excerpt: { type: Sequelize.TEXT, allowNull: true },
      artifacts: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'engineering_reviews', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      attempt_id: { type: Sequelize.UUID, allowNull: false },
      reviewer_provider: { type: Sequelize.STRING, allowNull: true },
      reviewer_model: { type: Sequelize.STRING, allowNull: true },
      decision: { type: Sequelize.STRING, allowNull: true },
      findings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      independent_of_coder: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      raw_response_ref: { type: Sequelize.STRING, allowNull: true },
      error: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'engineering_telemetry_events', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      task_id: { type: Sequelize.UUID, allowNull: false },
      attempt_id: { type: Sequelize.UUID, allowNull: true },
      role: { type: Sequelize.STRING, allowNull: false },
      provider: { type: Sequelize.STRING, allowNull: true },
      model: { type: Sequelize.STRING, allowNull: true },
      input_tokens: { type: Sequelize.INTEGER, allowNull: true },
      output_tokens: { type: Sequelize.INTEGER, allowNull: true },
      estimated_cost: { type: Sequelize.STRING, allowNull: false, defaultValue: 'UNKNOWN' },
      latency_ms: { type: Sequelize.INTEGER, allowNull: true },
      result: { type: Sequelize.STRING, allowNull: false },
      test_pass: { type: Sequelize.BOOLEAN, allowNull: true },
      review_result: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'engineering_tasks', ['status'], { name: 'engineering_tasks_status_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_tasks', ['task_type'], { name: 'engineering_tasks_type_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_tasks', ['risk'], { name: 'engineering_tasks_risk_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_tasks', ['idempotency_key'], { name: 'engineering_tasks_idempotency_key_unique', unique: true });

    await addIndexIfNotExists(queryInterface, 'engineering_attempts', ['task_id', 'attempt_number'], { name: 'engineering_attempts_task_attempt_idx', unique: true });
    await addIndexIfNotExists(queryInterface, 'engineering_attempts', ['status'], { name: 'engineering_attempts_status_idx' });

    await addIndexIfNotExists(queryInterface, 'engineering_test_runs', ['attempt_id'], { name: 'engineering_test_runs_attempt_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_test_runs', ['status'], { name: 'engineering_test_runs_status_idx' });

    await addIndexIfNotExists(queryInterface, 'engineering_reviews', ['attempt_id'], { name: 'engineering_reviews_attempt_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_reviews', ['decision'], { name: 'engineering_reviews_decision_idx' });

    await addIndexIfNotExists(queryInterface, 'engineering_telemetry_events', ['task_id'], { name: 'engineering_telemetry_task_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_telemetry_events', ['role'], { name: 'engineering_telemetry_role_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_telemetry_events', ['provider', 'model'], { name: 'engineering_telemetry_provider_model_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_telemetry_events').catch(() => {});
    await queryInterface.dropTable('engineering_reviews').catch(() => {});
    await queryInterface.dropTable('engineering_test_runs').catch(() => {});
    await queryInterface.dropTable('engineering_attempts').catch(() => {});
    await queryInterface.dropTable('engineering_tasks').catch(() => {});
  },
};
