'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'fitness_classes', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      instructor_id: { type: Sequelize.STRING(128), allowNull: true },
      category: { type: Sequelize.STRING(80), allowNull: true },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      default_capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_classes', ['tenant_key', 'active'], { name: 'fitness_classes_tenant_active_idx' });
    await addIndexIfNotExists(queryInterface, 'fitness_classes', ['tenant_key', 'category'], { name: 'fitness_classes_tenant_category_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_class_schedules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      class_id: { type: Sequelize.STRING(128), allowNull: false },
      start_at: { type: Sequelize.DATE, allowNull: false },
      end_at: { type: Sequelize.DATE, allowNull: false },
      capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      location: { type: Sequelize.STRING(120), allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'scheduled' },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_class_schedules', ['tenant_key', 'class_id', 'start_at'], { name: 'fitness_class_schedules_tenant_class_start_idx' });
    await addIndexIfNotExists(queryInterface, 'fitness_class_schedules', ['tenant_key', 'status', 'start_at'], { name: 'fitness_class_schedules_tenant_status_start_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_memberships', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      member_id: { type: Sequelize.STRING(128), allowNull: false },
      plan_name: { type: Sequelize.STRING(120), allowNull: false },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY, allowNull: true },
      allowed_classes: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      allowed_weekly_frequency: { type: Sequelize.INTEGER, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_memberships', ['tenant_key', 'member_id', 'active'], { name: 'fitness_memberships_tenant_member_active_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_attendance', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      class_schedule_id: { type: Sequelize.STRING(128), allowNull: false },
      member_id: { type: Sequelize.STRING(128), allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'booked' },
      checkin_time: { type: Sequelize.DATE, allowNull: true },
      booking_time: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_attendance', ['tenant_key', 'class_schedule_id', 'member_id'], { name: 'fitness_attendance_tenant_schedule_member_uidx', unique: true });
    await addIndexIfNotExists(queryInterface, 'fitness_attendance', ['tenant_key', 'member_id', 'status'], { name: 'fitness_attendance_tenant_member_status_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_checkins', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      member_id: { type: Sequelize.STRING(128), allowNull: false },
      class_schedule_id: { type: Sequelize.STRING(128), allowNull: true },
      source: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'manual' },
      kiosk_session_id: { type: Sequelize.STRING(128), allowNull: true },
      checked_in_at: { type: Sequelize.DATE, allowNull: false },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_checkins', ['tenant_key', 'member_id', 'checked_in_at'], { name: 'fitness_checkins_tenant_member_time_idx' });
    await addIndexIfNotExists(queryInterface, 'fitness_checkins', ['tenant_key', 'kiosk_session_id'], { name: 'fitness_checkins_tenant_kiosk_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_member_goals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      member_id: { type: Sequelize.STRING(128), allowNull: false },
      goal_type: { type: Sequelize.STRING(80), allowNull: false },
      target_value: { type: Sequelize.STRING(120), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_member_goals', ['tenant_key', 'member_id', 'active'], { name: 'fitness_member_goals_tenant_member_active_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fitness_member_goals');
    await queryInterface.dropTable('fitness_checkins');
    await queryInterface.dropTable('fitness_attendance');
    await queryInterface.dropTable('fitness_memberships');
    await queryInterface.dropTable('fitness_class_schedules');
    await queryInterface.dropTable('fitness_classes');
  },
};
