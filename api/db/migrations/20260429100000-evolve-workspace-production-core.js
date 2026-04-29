'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'workspace_entity_links', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: false },
      source_type: { type: Sequelize.STRING, allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: false },
      confidence: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'workspace_entity_links', ['tenant_id', 'entity_id', 'source_type'], { name: 'workspace_links_tenant_entity_type_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_entity_links', ['tenant_id', 'source_type', 'source_id'], { unique: true, name: 'workspace_links_tenant_source_unique' });

    await createTableIfNotExists(queryInterface, 'tasks', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      ticket_id: { type: Sequelize.STRING, allowNull: true },
      project_id: { type: Sequelize.UUID, allowNull: true },
      conversation_id: { type: Sequelize.STRING, allowNull: true },
      title: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'manual' },
      priority: { type: Sequelize.STRING, allowNull: false, defaultValue: 'normal' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'open' },
      due_date: { type: Sequelize.DATE, allowNull: true },
      assigned_to: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'tasks', ['tenant_id', 'entity_id', 'created_at'], { name: 'tasks_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'tasks', ['tenant_id', 'status'], { name: 'tasks_tenant_status_idx' });
    await addIndexIfNotExists(queryInterface, 'tasks', ['tenant_id', 'ticket_id'], { name: 'tasks_tenant_ticket_idx' });
    await addIndexIfNotExists(queryInterface, 'tasks', ['tenant_id', 'project_id'], { name: 'tasks_tenant_project_idx' });

    await createTableIfNotExists(queryInterface, 'timesheet_entries', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      task_id: { type: Sequelize.UUID, allowNull: true },
      ticket_id: { type: Sequelize.STRING, allowNull: true },
      project_id: { type: Sequelize.UUID, allowNull: true },
      user_id: { type: Sequelize.STRING, allowNull: true },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'timesheet_entries', ['tenant_id', 'entity_id', 'created_at'], { name: 'timesheet_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'timesheet_entries', ['tenant_id', 'project_id', 'created_at'], { name: 'timesheet_tenant_project_created_idx' });
    await addIndexIfNotExists(queryInterface, 'timesheet_entries', ['tenant_id', 'ticket_id', 'created_at'], { name: 'timesheet_tenant_ticket_created_idx' });

    await createTableIfNotExists(queryInterface, 'resources', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'resources', ['tenant_id', 'type'], { name: 'resources_tenant_type_idx' });

    await createTableIfNotExists(queryInterface, 'resource_availabilities', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      resource_id: { type: Sequelize.UUID, allowNull: false },
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'available' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'resource_availabilities', ['tenant_id', 'resource_id', 'starts_at'], { name: 'resource_avail_tenant_resource_start_idx' });

    await createTableIfNotExists(queryInterface, 'resource_bookings', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      resource_id: { type: Sequelize.UUID, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      task_id: { type: Sequelize.UUID, allowNull: true },
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'booked' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'resource_bookings', ['tenant_id', 'resource_id', 'starts_at'], { name: 'resource_bookings_tenant_resource_start_idx' });
    await addIndexIfNotExists(queryInterface, 'resource_bookings', ['tenant_id', 'entity_id'], { name: 'resource_bookings_tenant_entity_idx' });

    await createTableIfNotExists(queryInterface, 'payment_events', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'payment' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'payment_events', ['tenant_id', 'entity_id', 'created_at'], { name: 'payment_events_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'payment_events', ['tenant_id', 'status'], { name: 'payment_events_tenant_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_events').catch(() => {});
    await queryInterface.dropTable('resource_bookings').catch(() => {});
    await queryInterface.dropTable('resource_availabilities').catch(() => {});
    await queryInterface.dropTable('resources').catch(() => {});
    await queryInterface.dropTable('timesheet_entries').catch(() => {});
    await queryInterface.dropTable('tasks').catch(() => {});
    await queryInterface.dropTable('workspace_entity_links').catch(() => {});
  },
};
