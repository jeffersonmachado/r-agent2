'use strict';

/**
 * Physical queues v1: multi-unit uniqueness + robust ticket sequencing.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // Update unique index to allow same queue name across locations.
    await queryInterface.removeIndex('physical_queues', 'physical_queues_tenant_key_name_uq').catch(() => {});
    await queryInterface.addIndex('physical_queues', ['tenant_key', 'location_id', 'name'], {
      unique: true,
      name: 'physical_queues_tenant_location_name_uq',
    }).catch(() => {});

    // Ticket sequences per tenant+location+queue+day.
    await queryInterface.createTable('physical_ticket_sequences', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      location_id: { type: Sequelize.STRING, allowNull: true },
      physical_queue_id: { type: Sequelize.STRING, allowNull: false },
      day: { type: Sequelize.DATEONLY, allowNull: false },
      last_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    }).catch(() => {});

    await queryInterface.addIndex('physical_ticket_sequences', ['tenant_key', 'location_id', 'physical_queue_id', 'day'], {
      unique: true,
      name: 'physical_ticket_sequences_tenant_loc_queue_day_uq',
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.dropTable('physical_ticket_sequences').catch(() => {});
    await queryInterface.removeIndex('physical_queues', 'physical_queues_tenant_location_name_uq').catch(() => {});
    await queryInterface.addIndex('physical_queues', ['tenant_key', 'name'], {
      unique: true,
      name: 'physical_queues_tenant_key_name_uq',
    }).catch(() => {});
  },
};

