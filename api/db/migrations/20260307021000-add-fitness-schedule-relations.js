'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'fitness_schedule_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      class_schedule_id: { type: Sequelize.STRING(128), allowNull: false },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: true },
      professional_id: { type: Sequelize.STRING(128), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_professionals', ['tenant_key', 'class_schedule_id', 'professional_id'], {
      name: 'fitness_schedule_prof_tenant_sched_prof_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_professionals', ['tenant_key', 'professional_id'], {
      name: 'fitness_schedule_prof_tenant_prof_idx',
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_professionals', ['tenant_key', 'operational_schedule_id'], {
      name: 'fitness_schedule_prof_tenant_operational_idx',
    });

    await createTableIfNotExists(queryInterface, 'fitness_schedule_resources', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      class_schedule_id: { type: Sequelize.STRING(128), allowNull: false },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: true },
      resource_id: { type: Sequelize.STRING(128), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      exclusive_use: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_resources', ['tenant_key', 'class_schedule_id', 'resource_id'], {
      name: 'fitness_schedule_res_tenant_sched_res_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_resources', ['tenant_key', 'resource_id'], {
      name: 'fitness_schedule_res_tenant_res_idx',
    });
    await addIndexIfNotExists(queryInterface, 'fitness_schedule_resources', ['tenant_key', 'operational_schedule_id'], {
      name: 'fitness_schedule_res_tenant_operational_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fitness_schedule_resources');
    await queryInterface.dropTable('fitness_schedule_professionals');
  },
};
