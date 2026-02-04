/**
 * Marketing v1 core (forms, leads, scoring, email campaigns).
 *
 * Tables:
 * - marketing_forms
 * - marketing_leads
 * - marketing_form_submissions
 * - marketing_scoring_rules
 * - marketing_email_campaigns
 * - marketing_email_sends
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'marketing_forms', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING(120), allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      fields: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      landing_html: { type: Sequelize.TEXT, allowNull: true },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_forms', ['tenant_key', 'slug'], {
      name: 'marketing_forms_tenant_slug_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'marketing_forms', ['tenant_key', 'status'], {
      name: 'marketing_forms_tenant_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'marketing_leads', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: true },
      phone: { type: Sequelize.STRING(32), allowNull: true },
      external_id: { type: Sequelize.STRING(128), allowNull: true },
      name: { type: Sequelize.STRING(200), allowNull: true },
      stage: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'visitor' }, // visitor|lead|qualified|customer
      score: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      last_seen_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_leads', ['tenant_key', 'email'], {
      name: 'marketing_leads_tenant_email_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_leads', ['tenant_key', 'phone'], {
      name: 'marketing_leads_tenant_phone_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_leads', ['tenant_key', 'external_id'], {
      name: 'marketing_leads_tenant_external_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_leads', ['tenant_key', 'stage'], {
      name: 'marketing_leads_tenant_stage_idx',
    });

    await createTableIfNotExists(queryInterface, 'marketing_form_submissions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      form_id: { type: Sequelize.STRING, allowNull: false },
      lead_id: { type: Sequelize.STRING, allowNull: true },
      external_submission_id: { type: Sequelize.STRING(160), allowNull: true },
      data: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      ip_address: { type: Sequelize.STRING(64), allowNull: true },
      user_agent: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_form_submissions', ['tenant_key', 'form_id'], {
      name: 'marketing_form_submissions_tenant_form_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_form_submissions', ['tenant_key', 'external_submission_id'], {
      name: 'marketing_form_submissions_tenant_external_submission_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'marketing_scoring_rules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      event_type: { type: Sequelize.STRING(120), allowNull: false }, // MarketingPageView|MarketingFormSubmitted|...
      delta: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      conditions: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_scoring_rules', ['tenant_key', 'event_type'], {
      name: 'marketing_scoring_rules_tenant_event_idx',
    });

    await createTableIfNotExists(queryInterface, 'marketing_email_campaigns', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      subject: { type: Sequelize.STRING(500), allowNull: false },
      body_text: { type: Sequelize.TEXT, allowNull: false },
      body_html: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'draft' }, // draft|scheduled|sending|sent
      min_score: { type: Sequelize.INTEGER, allowNull: true },
      scheduled_at: { type: Sequelize.DATE, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_email_campaigns', ['tenant_key', 'status'], {
      name: 'marketing_email_campaigns_tenant_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'marketing_email_sends', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: false },
      lead_id: { type: Sequelize.STRING, allowNull: true },
      to_email: { type: Sequelize.STRING(255), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'pending' }, // pending|queued|sent|failed
      external_message_id: { type: Sequelize.STRING(160), allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'marketing_email_sends', ['tenant_key', 'campaign_id'], {
      name: 'marketing_email_sends_tenant_campaign_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_email_sends', ['tenant_key', 'campaign_id', 'lead_id'], {
      name: 'marketing_email_sends_campaign_lead_uq',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('marketing_email_sends').catch(() => {});
    await queryInterface.dropTable('marketing_email_campaigns').catch(() => {});
    await queryInterface.dropTable('marketing_scoring_rules').catch(() => {});
    await queryInterface.dropTable('marketing_form_submissions').catch(() => {});
    await queryInterface.dropTable('marketing_leads').catch(() => {});
    await queryInterface.dropTable('marketing_forms').catch(() => {});
  },
};

