'use strict';

/**
 * Migration: General Scheduling Infrastructure (operational)
 *
 * This migration creates a general-purpose scheduling domain:
 * - operational_schedules: central schedule/event object
 * - schedule_working_hours: generic availability windows (team/owner)
 * - schedule_blocks: manual/system blocking windows (team/owner)
 * - schedule_reminders: reminder engine queue with configurable offsets/actions
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'operational_schedules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },

      context_type: { type: Sequelize.STRING(24), allowNull: false }, // ticket|crm|task|system|custom
      context_id: { type: Sequelize.STRING(128), allowNull: false },

      contact_id: { type: Sequelize.STRING(128), allowNull: true },
      conversation_id: { type: Sequelize.STRING(128), allowNull: true },

      channel: { type: Sequelize.STRING(24), allowNull: false }, // whatsapp|voice|email|internal|system
      mode: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'free' }, // free|team_based
      origin: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'human' }, // bot|human|system

      start_at: { type: Sequelize.DATE, allowNull: false },
      end_at: { type: Sequelize.DATE, allowNull: false },
      timezone: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'UTC' },

      requires_confirmation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      confirmation_status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'not_required' }, // pending|confirmed|declined|not_required

      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'draft' }, // draft|scheduled|in_progress|done|no_show|canceled
      owner_id: { type: Sequelize.STRING(128), allowNull: true },
      team_id: { type: Sequelize.STRING(128), allowNull: true },

      purpose: { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'compromisso' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },

      idempotency_key: { type: Sequelize.STRING(160), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'context_type', 'context_id'], {
      name: 'operational_schedules_tenant_context_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'team_id', 'start_at'], {
      name: 'operational_schedules_tenant_team_start_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'owner_id', 'start_at'], {
      name: 'operational_schedules_tenant_owner_start_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_schedules', ['tenant_key', 'idempotency_key'], {
      name: 'operational_schedules_tenant_idempotency_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'schedule_working_hours', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      scope_type: { type: Sequelize.STRING(16), allowNull: false }, // team|owner
      scope_id: { type: Sequelize.STRING(128), allowNull: false },
      weekday: { type: Sequelize.INTEGER, allowNull: false }, // 0..6
      start_time: { type: Sequelize.STRING(5), allowNull: false }, // HH:mm
      end_time: { type: Sequelize.STRING(5), allowNull: false }, // HH:mm
      timezone: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'UTC' },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'schedule_working_hours', ['tenant_key', 'scope_type', 'scope_id', 'weekday', 'enabled'], {
      name: 'schedule_working_hours_tenant_scope_weekday_enabled_idx',
    });

    await createTableIfNotExists(queryInterface, 'schedule_blocks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      scope_type: { type: Sequelize.STRING(16), allowNull: false }, // team|owner
      scope_id: { type: Sequelize.STRING(128), allowNull: false },
      start_at: { type: Sequelize.DATE, allowNull: false },
      end_at: { type: Sequelize.DATE, allowNull: false },
      reason: { type: Sequelize.STRING(160), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'schedule_blocks', ['tenant_key', 'scope_type', 'scope_id', 'active', 'start_at'], {
      name: 'schedule_blocks_tenant_scope_active_start_idx',
    });

    await createTableIfNotExists(queryInterface, 'schedule_reminders', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      schedule_id: { type: Sequelize.STRING, allowNull: false },
      offset_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      action: { type: Sequelize.STRING(40), allowNull: false }, // notify|request_confirmation|mark_no_show
      channel: { type: Sequelize.STRING(24), allowNull: true },
      execute_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' }, // pending|done|failed|canceled
      payload: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      processing_started_at: { type: Sequelize.DATE, allowNull: true },
      executed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'schedule_reminders', ['tenant_key', 'execute_at', 'status'], {
      name: 'schedule_reminders_tenant_execute_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'schedule_reminders', ['schedule_id', 'offset_minutes', 'action'], {
      name: 'schedule_reminders_schedule_offset_action_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('schedule_reminders');
    await queryInterface.dropTable('schedule_blocks');
    await queryInterface.dropTable('schedule_working_hours');
    await queryInterface.dropTable('operational_schedules');
  },
};
