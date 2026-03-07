'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'autonomous_schedule_policies', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      channel: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'whatsapp' },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      auto_fill_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      waiting_list_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      reactivation_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      min_notice_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      fill_horizon_hours: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 48 },
      max_invites_per_campaign: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 8 },
      max_invites_per_contact_day: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 2 },
      max_invites_per_contact_week: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 5 },
      cooldown_hours_after_reject: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 48 },
      cooldown_hours_after_no_response: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 24 },
      send_window_start: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '08:00' },
      send_window_end: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '19:00' },
      allowed_weekdays: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[0,1,2,3,4,5,6]' },
      settings: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_schedule_policies', ['tenant_key', 'enabled'], {
      name: 'autonomous_schedule_policies_tenant_enabled_idx',
    });

    await createTableIfNotExists(queryInterface, 'autonomous_waiting_list', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      contact_id: { type: Sequelize.STRING(128), allowNull: false },
      context_type: { type: Sequelize.STRING(24), allowNull: true },
      context_id: { type: Sequelize.STRING(128), allowNull: true },
      desired_channel: { type: Sequelize.STRING(24), allowNull: true },
      service_type: { type: Sequelize.STRING(120), allowNull: true },
      owner_id: { type: Sequelize.STRING(128), allowNull: true },
      team_id: { type: Sequelize.STRING(128), allowNull: true },
      preferred_weekdays: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      preferred_time_windows: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_waiting_list', ['tenant_key', 'active', 'service_type'], {
      name: 'autonomous_waiting_list_tenant_active_service_idx',
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_waiting_list', ['tenant_key', 'contact_id', 'active'], {
      name: 'autonomous_waiting_list_tenant_contact_active_idx',
    });

    await createTableIfNotExists(queryInterface, 'autonomous_gap_campaigns', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      operational_schedule_id: { type: Sequelize.STRING(128), allowNull: true },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'detected_gap' },
      channel: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'whatsapp' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'open' },
      context_type: { type: Sequelize.STRING(24), allowNull: false },
      context_id: { type: Sequelize.STRING(128), allowNull: false },
      service_type: { type: Sequelize.STRING(120), allowNull: true },
      owner_id: { type: Sequelize.STRING(128), allowNull: true },
      team_id: { type: Sequelize.STRING(128), allowNull: true },
      gap_start_at: { type: Sequelize.DATE, allowNull: false },
      gap_end_at: { type: Sequelize.DATE, allowNull: false },
      timezone: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'UTC' },
      max_invites: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 8 },
      sent_invites: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      accepted_contact_id: { type: Sequelize.STRING(128), allowNull: true },
      closed_reason: { type: Sequelize.STRING(64), allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      started_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_gap_campaigns', ['tenant_key', 'status', 'gap_start_at'], {
      name: 'autonomous_gap_campaigns_tenant_status_gap_idx',
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_gap_campaigns', ['tenant_key', 'context_type', 'context_id', 'status'], {
      name: 'autonomous_gap_campaigns_tenant_context_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'autonomous_gap_candidates', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      campaign_id: { type: Sequelize.STRING(128), allowNull: false },
      contact_id: { type: Sequelize.STRING(128), allowNull: false },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'ranked' },
      score: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      score_breakdown: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      invite_status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' },
      invite_channel: { type: Sequelize.STRING(24), allowNull: true },
      outbound_message_id: { type: Sequelize.STRING(128), allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      responded_at: { type: Sequelize.DATE, allowNull: true },
      response_type: { type: Sequelize.STRING(32), allowNull: true },
      cooldown_until: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_gap_candidates', ['tenant_key', 'campaign_id', 'invite_status'], {
      name: 'autonomous_gap_candidates_tenant_campaign_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_gap_candidates', ['tenant_key', 'contact_id', 'sent_at'], {
      name: 'autonomous_gap_candidates_tenant_contact_sent_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('autonomous_gap_candidates');
    await queryInterface.dropTable('autonomous_gap_campaigns');
    await queryInterface.dropTable('autonomous_waiting_list');
    await queryInterface.dropTable('autonomous_schedule_policies');
  },
};
