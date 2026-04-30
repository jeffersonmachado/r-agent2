'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'autocorrection_runs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      source_type: { type: Sequelize.STRING, allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'detected' },
      diagnosis: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      proposed_patch: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      validation_result: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'autocorrection_actions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      run_id: { type: Sequelize.UUID, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'autocorrection_runs', ['tenant_id', 'source_type', 'source_id'], { name: 'autocorrection_runs_tenant_source_idx' });
    await addIndexIfNotExists(queryInterface, 'autocorrection_runs', ['tenant_id', 'status', 'created_at'], { name: 'autocorrection_runs_tenant_status_created_idx' });
    await addIndexIfNotExists(queryInterface, 'autocorrection_actions', ['run_id', 'created_at'], { name: 'autocorrection_actions_run_created_idx' });
    await addIndexIfNotExists(queryInterface, 'autocorrection_actions', ['type', 'status'], { name: 'autocorrection_actions_type_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('autocorrection_actions').catch(() => {});
    await queryInterface.dropTable('autocorrection_runs').catch(() => {});
  },
};