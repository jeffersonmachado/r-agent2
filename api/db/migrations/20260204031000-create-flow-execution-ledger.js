/**
 * Migration: flow_executions + node_executions (execution ledger v1)
 *
 * Goal:
 * - Persist execution history per node (inputs/outputs/state) for audit/debug.
 * - Enable replay from a given node in controlled mode.
 */
 
'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'flow_executions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      flow_id: { type: Sequelize.STRING, allowNull: false },
      flow_version: { type: Sequelize.INTEGER, allowNull: true },
      session_id: { type: Sequelize.STRING, allowNull: true },
      correlation_id: { type: Sequelize.STRING, allowNull: true },
      subject_type: { type: Sequelize.STRING(40), allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'running' }, // running|done|failed
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      meta: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'flow_executions', ['tenant_key', 'started_at'], {
      name: 'flow_executions_tenant_started_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'flow_executions', ['tenant_key', 'correlation_id'], {
      name: 'flow_executions_tenant_correlation_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'flow_executions', ['tenant_key', 'session_id'], {
      name: 'flow_executions_tenant_session_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'flow_executions', ['tenant_key', 'subject_type', 'subject_id'], {
      name: 'flow_executions_tenant_subject_idx',
    });

    await createTableIfNotExists(queryInterface, 'node_executions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      execution_id: { type: Sequelize.STRING, allowNull: false },
      node_id: { type: Sequelize.STRING, allowNull: true },
      node_type: { type: Sequelize.STRING(80), allowNull: true },
      step_index: { type: Sequelize.INTEGER, allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'ok' }, // ok|error
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      input: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      output: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      state_before: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      state_after: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      events: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'node_executions', ['tenant_key', 'execution_id', 'step_index'], {
      name: 'node_executions_tenant_execution_step_idx',
    });
    await addIndexIfNotExists(queryInterface, 'node_executions', ['tenant_key', 'execution_id', 'created_at'], {
      name: 'node_executions_tenant_execution_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'node_executions', ['tenant_key', 'node_id'], {
      name: 'node_executions_tenant_node_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('node_executions');
    await queryInterface.dropTable('flow_executions');
  },
};

