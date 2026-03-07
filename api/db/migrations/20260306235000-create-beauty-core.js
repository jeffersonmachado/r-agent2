'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'beauty_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      specialty: { type: Sequelize.STRING(120), allowNull: true },
      schedule_ref: { type: Sequelize.STRING(128), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_professionals', ['tenant_key', 'active'], { name: 'beauty_professionals_tenant_active_idx' });
    await addIndexIfNotExists(queryInterface, 'beauty_professionals', ['tenant_key', 'name'], { name: 'beauty_professionals_tenant_name_idx' });

    await createTableIfNotExists(queryInterface, 'beauty_services', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      category: { type: Sequelize.STRING(80), allowNull: true },
      default_duration: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      default_price: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_services', ['tenant_key', 'active'], { name: 'beauty_services_tenant_active_idx' });
    await addIndexIfNotExists(queryInterface, 'beauty_services', ['tenant_key', 'category'], { name: 'beauty_services_tenant_category_idx' });

    await createTableIfNotExists(queryInterface, 'beauty_service_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      service_id: { type: Sequelize.STRING(128), allowNull: false },
      professional_id: { type: Sequelize.STRING(128), allowNull: false },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: true },
      price_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_service_professionals', ['tenant_key', 'service_id', 'professional_id'], { name: 'beauty_service_professionals_tenant_service_prof_idx', unique: true });
    await addIndexIfNotExists(queryInterface, 'beauty_service_professionals', ['tenant_key', 'professional_id', 'active'], { name: 'beauty_service_professionals_tenant_prof_active_idx' });

    await createTableIfNotExists(queryInterface, 'beauty_service_compositions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      parent_service_id: { type: Sequelize.STRING(128), allowNull: false },
      child_service_id: { type: Sequelize.STRING(128), allowNull: false },
      sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      optional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_service_compositions', ['tenant_key', 'parent_service_id', 'sequence'], { name: 'beauty_service_compositions_tenant_parent_seq_idx' });
    await addIndexIfNotExists(queryInterface, 'beauty_service_compositions', ['tenant_key', 'parent_service_id', 'child_service_id'], { name: 'beauty_service_compositions_tenant_parent_child_idx', unique: true });

    await createTableIfNotExists(queryInterface, 'beauty_loyalty', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      contact_id: { type: Sequelize.STRING(128), allowNull: false },
      visits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      points: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_visit_at: { type: Sequelize.DATE, allowNull: true },
      segment: { type: Sequelize.STRING(80), allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_loyalty', ['tenant_key', 'contact_id'], { name: 'beauty_loyalty_tenant_contact_uidx', unique: true });
    await addIndexIfNotExists(queryInterface, 'beauty_loyalty', ['tenant_key', 'segment'], { name: 'beauty_loyalty_tenant_segment_idx' });

    await createTableIfNotExists(queryInterface, 'beauty_client_preferences', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      contact_id: { type: Sequelize.STRING(128), allowNull: false },
      preferred_professional_id: { type: Sequelize.STRING(128), allowNull: true },
      preferred_services: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      preferred_days: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      preferred_time_ranges: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_client_preferences', ['tenant_key', 'contact_id'], { name: 'beauty_client_preferences_tenant_contact_uidx', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('beauty_client_preferences');
    await queryInterface.dropTable('beauty_loyalty');
    await queryInterface.dropTable('beauty_service_compositions');
    await queryInterface.dropTable('beauty_service_professionals');
    await queryInterface.dropTable('beauty_services');
    await queryInterface.dropTable('beauty_professionals');
  },
};
