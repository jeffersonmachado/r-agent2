'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'process_execution_events', {
      event_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      execution_id: { type: Sequelize.STRING, allowNull: false },
      sequence: { type: Sequelize.INTEGER, allowNull: false },
      process_id: { type: Sequelize.STRING, allowNull: false },
      process_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      node_id: { type: Sequelize.STRING, allowNull: true },
      node_type: { type: Sequelize.STRING, allowNull: true },
      event_type: { type: Sequelize.STRING, allowNull: false },
      timestamp: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'process_execution_events', ['execution_id', 'sequence'], {
      name: 'process_execution_events_execution_sequence_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'process_execution_events', ['process_id', 'process_version'], {
      name: 'process_execution_events_process_version_idx',
    });
    await addIndexIfNotExists(queryInterface, 'process_execution_events', ['event_type', 'timestamp'], {
      name: 'process_execution_events_type_timestamp_idx',
    });

    await createTableIfNotExists(queryInterface, 'process_compiled_definitions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: true },
      process_id: { type: Sequelize.STRING, allowNull: false },
      process_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      source_type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'compiled' },
      source_definition: { type: Sequelize.JSONB, allowNull: true },
      compiled_definition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'process_compiled_definitions', ['tenant_key', 'process_id', 'process_version'], {
      name: 'process_compiled_definitions_tenant_process_version_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'process_compiled_definitions', ['process_id', 'process_version'], {
      name: 'process_compiled_definitions_process_version_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('process_compiled_definitions');
    await queryInterface.dropTable('process_execution_events');
  },
};
