/**
 * Migration: Create physical_queues table (tenant_key-based)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'physical_queues', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      location_id: { type: Sequelize.STRING, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      rules: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'physical_queues', ['tenant_key', 'name'], {
      name: 'physical_queues_tenant_key_name_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'physical_queues', ['tenant_key', 'status'], {
      name: 'physical_queues_tenant_key_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'physical_queues', ['tenant_key', 'location_id'], {
      name: 'physical_queues_tenant_key_location_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('physical_queues');
  },
};

