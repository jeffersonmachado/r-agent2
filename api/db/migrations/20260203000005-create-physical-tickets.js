/**
 * Migration: Create physical_tickets table (tenant_key-based)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'physical_tickets', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      physical_queue_id: { type: Sequelize.STRING, allowNull: false },
      ticket_number: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'waiting' },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      called_at: { type: Sequelize.DATE, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      station_id: { type: Sequelize.STRING, allowNull: true },
      context: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'physical_tickets', ['tenant_key', 'physical_queue_id', 'status'], {
      name: 'physical_tickets_tenant_queue_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'physical_tickets', ['tenant_key', 'created_at'], {
      name: 'physical_tickets_tenant_key_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'physical_tickets', ['tenant_key', 'ticket_number'], {
      name: 'physical_tickets_tenant_key_ticket_number_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('physical_tickets');
  },
};

