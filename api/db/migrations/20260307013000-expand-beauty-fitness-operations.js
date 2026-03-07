'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  try {
    const columns = await queryInterface.describeTable(tableName);
    if (!columns || columns[columnName]) return;
    await queryInterface.addColumn(tableName, columnName, definition);
  } catch (err) {
    console.error(`[Migration] Falha ao adicionar coluna ${tableName}.${columnName}:`, err.message);
    throw err;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'beauty_professionals', 'specialties', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: '[]',
    });
    await addColumnIfMissing(queryInterface, 'beauty_professionals', 'max_daily_sessions', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'beauty_professionals', 'working_hours', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: '{}',
    });

    await addColumnIfMissing(queryInterface, 'fitness_classes', 'operation_mode', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'group_class',
    });
    await addIndexIfNotExists(queryInterface, 'fitness_classes', ['tenant_key', 'operation_mode'], {
      name: 'fitness_classes_tenant_mode_idx',
    });

    await createTableIfNotExists(queryInterface, 'fitness_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      role_type: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'instructor' },
      specialties: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      can_group_sessions: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      can_individual_sessions: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      max_concurrent_sessions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_professionals', ['tenant_key', 'active'], { name: 'fitness_professionals_tenant_active_idx' });
    await addIndexIfNotExists(queryInterface, 'fitness_professionals', ['tenant_key', 'role_type'], { name: 'fitness_professionals_tenant_role_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_resources', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      resource_type: { type: Sequelize.STRING(48), allowNull: false, defaultValue: 'room' },
      capacity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      location: { type: Sequelize.STRING(120), allowNull: true },
      exclusive_use: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_resources', ['tenant_key', 'active'], { name: 'fitness_resources_tenant_active_idx' });
    await addIndexIfNotExists(queryInterface, 'fitness_resources', ['tenant_key', 'resource_type'], { name: 'fitness_resources_tenant_type_idx' });

    await createTableIfNotExists(queryInterface, 'fitness_activity_professionals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      activity_id: { type: Sequelize.STRING(128), allowNull: false },
      professional_id: { type: Sequelize.STRING(128), allowNull: false },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: true },
      default_price: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      max_capacity_override: { type: Sequelize.INTEGER, allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_activity_professionals', ['tenant_key', 'activity_id', 'professional_id'], {
      name: 'fitness_activity_professionals_tenant_activity_prof_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'fitness_activity_professionals', ['tenant_key', 'professional_id'], {
      name: 'fitness_activity_professionals_tenant_prof_idx',
    });

    await createTableIfNotExists(queryInterface, 'fitness_activity_resources', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      activity_id: { type: Sequelize.STRING(128), allowNull: false },
      resource_id: { type: Sequelize.STRING(128), allowNull: false },
      required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      exclusive_use: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'fitness_activity_resources', ['tenant_key', 'activity_id', 'resource_id'], {
      name: 'fitness_activity_resources_tenant_activity_res_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'fitness_activity_resources', ['tenant_key', 'resource_id'], {
      name: 'fitness_activity_resources_tenant_res_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fitness_activity_resources');
    await queryInterface.dropTable('fitness_activity_professionals');
    await queryInterface.dropTable('fitness_resources');
    await queryInterface.dropTable('fitness_professionals');
  },
};
