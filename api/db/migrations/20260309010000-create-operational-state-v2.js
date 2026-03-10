'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'operational_signals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      contact_id: { type: Sequelize.STRING(191), allowNull: true },
      signal_type: { type: Sequelize.STRING(120), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'open' },
      severity: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      confidence: { type: Sequelize.DECIMAL(7, 4), allowNull: false, defaultValue: 0.5 },
      source_module: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'operational_agent' },
      context_json: { type: Sequelize.TEXT, allowNull: true },
      detected_at: { type: Sequelize.DATE, allowNull: false },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_signals', ['tenant_key', 'status', 'detected_at'], {
      name: 'oper_signals_tenant_status_detected_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_signals', ['tenant_key', 'contact_id', 'status', 'detected_at'], {
      name: 'oper_signals_tenant_contact_status_detected_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_signals', ['tenant_key', 'signal_type', 'status', 'detected_at'], {
      name: 'oper_signals_tenant_type_status_detected_idx',
    });

    await createTableIfNotExists(queryInterface, 'operational_recommendations', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      contact_id: { type: Sequelize.STRING(191), allowNull: true },
      recommendation_type: { type: Sequelize.STRING(120), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'open' },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
      confidence: { type: Sequelize.DECIMAL(7, 4), allowNull: false, defaultValue: 0.5 },
      impact_level: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      target_module: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'support' },
      description: { type: Sequelize.TEXT, allowNull: false },
      suggested_actions_json: { type: Sequelize.TEXT, allowNull: true },
      context_json: { type: Sequelize.TEXT, allowNull: true },
      source_signal_id: { type: Sequelize.STRING(191), allowNull: true },
      source_signal_type: { type: Sequelize.STRING(120), allowNull: true },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_recommendations', ['tenant_key', 'status', 'priority', 'updated_at'], {
      name: 'oper_recs_tenant_status_priority_updated_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_recommendations', ['tenant_key', 'contact_id', 'status', 'priority'], {
      name: 'oper_recs_tenant_contact_status_priority_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_recommendations', ['tenant_key', 'source_signal_id', 'recommendation_type'], {
      name: 'oper_recs_tenant_source_signal_type_idx',
    });

    await createTableIfNotExists(queryInterface, 'operational_playbook_executions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      playbook_id: { type: Sequelize.STRING(120), allowNull: false },
      playbook_name: { type: Sequelize.STRING(191), allowNull: false },
      contact_id: { type: Sequelize.STRING(191), allowNull: true },
      signal_id: { type: Sequelize.STRING(191), allowNull: true },
      recommendation_id: { type: Sequelize.STRING(191), allowNull: true },
      operator_id: { type: Sequelize.STRING(191), allowNull: true },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'in_progress' },
      current_step_index: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      steps_json: { type: Sequelize.TEXT, allowNull: true },
      context_json: { type: Sequelize.TEXT, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      aborted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_playbook_executions', ['tenant_key', 'status', 'updated_at'], {
      name: 'oper_play_exec_tenant_status_updated_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbook_executions', ['tenant_key', 'contact_id', 'updated_at'], {
      name: 'oper_play_exec_tenant_contact_updated_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbook_executions', ['tenant_key', 'playbook_id', 'status'], {
      name: 'oper_play_exec_tenant_playbook_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbook_executions', ['tenant_key', 'signal_id'], {
      name: 'oper_play_exec_tenant_signal_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbook_executions', ['tenant_key', 'recommendation_id'], {
      name: 'oper_play_exec_tenant_recommendation_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('operational_playbook_executions').catch(() => {});
    await queryInterface.dropTable('operational_recommendations').catch(() => {});
    await queryInterface.dropTable('operational_signals').catch(() => {});
  },
};
