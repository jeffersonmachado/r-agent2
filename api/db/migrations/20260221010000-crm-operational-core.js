'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'crm_accounts', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      external_id: { type: Sequelize.STRING(128), allowNull: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_accounts', ['tenant_key', 'external_id'], {
      name: 'crm_accounts_tenant_external_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'crm_accounts', ['tenant_key', 'status'], {
      name: 'crm_accounts_tenant_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'crm_contacts', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      account_id: { type: Sequelize.STRING, allowNull: true },
      external_id: { type: Sequelize.STRING(128), allowNull: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: true },
      phone: { type: Sequelize.STRING(40), allowNull: true },
      role: { type: Sequelize.STRING(120), allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_contacts', ['tenant_key', 'account_id'], {
      name: 'crm_contacts_tenant_account_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_contacts', ['tenant_key', 'email'], {
      name: 'crm_contacts_tenant_email_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_contacts', ['tenant_key', 'phone'], {
      name: 'crm_contacts_tenant_phone_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_contacts', ['tenant_key', 'external_id'], {
      name: 'crm_contacts_tenant_external_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'crm_leads', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      account_id: { type: Sequelize.STRING, allowNull: true },
      contact_id: { type: Sequelize.STRING, allowNull: true },
      external_id: { type: Sequelize.STRING(128), allowNull: true },
      source: { type: Sequelize.STRING(120), allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'new' },
      score: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_leads', ['tenant_key', 'status'], {
      name: 'crm_leads_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_leads', ['tenant_key', 'owner_user_id'], {
      name: 'crm_leads_tenant_owner_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_leads', ['tenant_key', 'external_id'], {
      name: 'crm_leads_tenant_external_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'crm_pipelines', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      stages: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_pipelines', ['tenant_key', 'name'], {
      name: 'crm_pipelines_tenant_name_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'crm_pipelines', ['tenant_key', 'status'], {
      name: 'crm_pipelines_tenant_status_idx',
    });

    await createTableIfNotExists(queryInterface, 'crm_opportunities', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      pipeline_id: { type: Sequelize.STRING, allowNull: false },
      stage_id: { type: Sequelize.STRING(120), allowNull: false },
      title: { type: Sequelize.STRING(240), allowNull: false },
      account_id: { type: Sequelize.STRING, allowNull: true },
      contact_id: { type: Sequelize.STRING, allowNull: true },
      lead_id: { type: Sequelize.STRING, allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      value_cents: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'BRL' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'open' },
      correlation_id: { type: Sequelize.STRING(120), allowNull: true },
      expected_close_at: { type: Sequelize.DATE, allowNull: true },
      attributes: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_opportunities', ['tenant_key', 'pipeline_id', 'stage_id'], {
      name: 'crm_opps_tenant_pipeline_stage_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_opportunities', ['tenant_key', 'owner_user_id'], {
      name: 'crm_opps_tenant_owner_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_opportunities', ['tenant_key', 'status'], {
      name: 'crm_opps_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_opportunities', ['tenant_key', 'correlation_id'], {
      name: 'crm_opps_tenant_correlation_idx',
    });

    await createTableIfNotExists(queryInterface, 'crm_activities', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING(80), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'open' },
      subject_type: { type: Sequelize.STRING(40), allowNull: true },
      subject_id: { type: Sequelize.STRING(128), allowNull: true },
      account_id: { type: Sequelize.STRING, allowNull: true },
      contact_id: { type: Sequelize.STRING, allowNull: true },
      lead_id: { type: Sequelize.STRING, allowNull: true },
      opportunity_id: { type: Sequelize.STRING, allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      due_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      correlation_id: { type: Sequelize.STRING(120), allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_activities', ['tenant_key', 'subject_type', 'subject_id'], {
      name: 'crm_activities_tenant_subject_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_activities', ['tenant_key', 'opportunity_id'], {
      name: 'crm_activities_tenant_opp_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_activities', ['tenant_key', 'owner_user_id', 'status'], {
      name: 'crm_activities_tenant_owner_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_activities', ['tenant_key', 'due_at'], {
      name: 'crm_activities_tenant_due_idx',
    });

    await createTableIfNotExists(queryInterface, 'crm_events', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      source_event_id: { type: Sequelize.STRING, allowNull: true },
      event_type: { type: Sequelize.STRING(120), allowNull: false },
      correlation_id: { type: Sequelize.STRING(120), allowNull: true },
      subject_type: { type: Sequelize.STRING(40), allowNull: true },
      subject_id: { type: Sequelize.STRING(128), allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'crm_events', ['tenant_key', 'event_type', 'occurred_at'], {
      name: 'crm_events_tenant_type_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_events', ['tenant_key', 'correlation_id', 'occurred_at'], {
      name: 'crm_events_tenant_correlation_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'crm_events', ['tenant_key', 'subject_type', 'subject_id', 'occurred_at'], {
      name: 'crm_events_tenant_subject_occurred_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('crm_events').catch(() => {});
    await queryInterface.dropTable('crm_activities').catch(() => {});
    await queryInterface.dropTable('crm_opportunities').catch(() => {});
    await queryInterface.dropTable('crm_pipelines').catch(() => {});
    await queryInterface.dropTable('crm_leads').catch(() => {});
    await queryInterface.dropTable('crm_contacts').catch(() => {});
    await queryInterface.dropTable('crm_accounts').catch(() => {});
  },
};
