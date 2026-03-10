'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'operational_actions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      contact_id: { type: Sequelize.STRING(191), allowNull: true },
      source_type: { type: Sequelize.STRING(30), allowNull: false },
      source_id: { type: Sequelize.STRING(191), allowNull: false },
      action_id: { type: Sequelize.STRING(120), allowNull: false },
      actor_type: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'system' },
      actor_id: { type: Sequelize.STRING(191), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'executed' },
      input_json: { type: Sequelize.TEXT, allowNull: true },
      result_json: { type: Sequelize.TEXT, allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      executed_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_actions', ['tenant_key', 'status', 'executed_at'], {
      name: 'oper_actions_tenant_status_executed_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_actions', ['tenant_key', 'contact_id', 'executed_at'], {
      name: 'oper_actions_tenant_contact_executed_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_actions', ['tenant_key', 'source_type', 'source_id'], {
      name: 'oper_actions_tenant_source_idx',
    });

    await createTableIfNotExists(queryInterface, 'operational_outcomes', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      action_id: { type: Sequelize.STRING(191), allowNull: true },
      playbook_execution_id: { type: Sequelize.STRING(191), allowNull: true },
      source_type: { type: Sequelize.STRING(30), allowNull: false },
      source_id: { type: Sequelize.STRING(191), allowNull: false },
      outcome_type: { type: Sequelize.STRING(120), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'success' },
      details_json: { type: Sequelize.TEXT, allowNull: true },
      produced_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'status', 'produced_at'], {
      name: 'oper_outcomes_tenant_status_produced_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'source_type', 'source_id'], {
      name: 'oper_outcomes_tenant_source_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'action_id', 'produced_at'], {
      name: 'oper_outcomes_tenant_action_idx',
    });

    await createTableIfNotExists(queryInterface, 'operational_playbooks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      playbook_key: { type: Sequelize.STRING(120), allowNull: false },
      name: { type: Sequelize.STRING(191), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      trigger_signal: { type: Sequelize.STRING(120), allowNull: true },
      definition_json: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_playbooks', ['tenant_key', 'status', 'updated_at'], {
      name: 'oper_playbooks_tenant_status_updated_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbooks', ['tenant_key', 'playbook_key'], {
      name: 'oper_playbooks_tenant_key_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'operational_playbooks', ['tenant_key', 'trigger_signal'], {
      name: 'oper_playbooks_tenant_trigger_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('operational_playbooks').catch(() => {});
    await queryInterface.dropTable('operational_outcomes').catch(() => {});
    await queryInterface.dropTable('operational_actions').catch(() => {});
  },
};
