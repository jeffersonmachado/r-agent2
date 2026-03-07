'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'beauty_schedule_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: false },
      beauty_professional_id: { type: Sequelize.STRING(128), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_professionals', ['tenant_key', 'operational_schedule_id', 'beauty_professional_id'], {
      name: 'beauty_sched_prof_tenant_sched_prof_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_professionals', ['tenant_key', 'beauty_professional_id'], {
      name: 'beauty_sched_prof_tenant_prof_idx',
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_professionals', ['tenant_key', 'operational_schedule_id'], {
      name: 'beauty_sched_prof_tenant_sched_idx',
    });

    await createTableIfNotExists(queryInterface, 'beauty_schedule_services', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: false },
      beauty_service_id: { type: Sequelize.STRING(128), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_services', ['tenant_key', 'operational_schedule_id', 'beauty_service_id'], {
      name: 'beauty_sched_svc_tenant_sched_svc_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_services', ['tenant_key', 'beauty_service_id'], {
      name: 'beauty_sched_svc_tenant_svc_idx',
    });
    await addIndexIfNotExists(queryInterface, 'beauty_schedule_services', ['tenant_key', 'operational_schedule_id'], {
      name: 'beauty_sched_svc_tenant_sched_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('beauty_schedule_services');
    await queryInterface.dropTable('beauty_schedule_professionals');
  },
};
