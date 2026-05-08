'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'access_subjects', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      vertical_profile: { type: Sequelize.STRING, allowNull: false, defaultValue: 'fitness' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_subjects', ['tenant_key', 'customer_id'], {
      name: 'access_subjects_tenant_customer_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_subjects', ['tenant_key', 'membership_id'], {
      name: 'access_subjects_tenant_membership_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_subjects', ['tenant_key', 'vertical_profile'], {
      name: 'access_subjects_tenant_vertical_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_memberships', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: false },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      vertical: { type: Sequelize.STRING, allowNull: false, defaultValue: 'fitness' },
      plan_name: { type: Sequelize.STRING, allowNull: true },
      billing_status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      unit_scope: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      start_at: { type: Sequelize.DATE, allowNull: true },
      end_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_memberships', ['tenant_key', 'subject_id'], {
      name: 'access_memberships_tenant_subject_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_memberships', ['tenant_key', 'billing_status'], {
      name: 'access_memberships_tenant_billing_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_credentials', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      credential_hash: { type: Sequelize.STRING, allowNull: true },
      credential_ref: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_credentials', ['tenant_key', 'subject_id'], {
      name: 'access_credentials_tenant_subject_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_credentials', ['tenant_key', 'type', 'status'], {
      name: 'access_credentials_tenant_type_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_credentials', ['tenant_key', 'credential_hash'], {
      name: 'access_credentials_tenant_hash_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_policies', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false, defaultValue: 'fitness' },
      applies_to: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      days_allowed: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      time_start: { type: Sequelize.STRING, allowNull: true },
      time_end: { type: Sequelize.STRING, allowNull: true },
      unit_scope: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      max_entries_per_day: { type: Sequelize.INTEGER, allowNull: true },
      anti_passback_mode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'none' },
      grace_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_policies', ['tenant_key', 'vertical'], {
      name: 'access_policies_tenant_vertical_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_policies', ['tenant_key', 'name'], {
      name: 'access_policies_tenant_name_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_devices', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      vendor: { type: Sequelize.STRING, allowNull: true },
      model: { type: Sequelize.STRING, allowNull: true },
      ip: { type: Sequelize.STRING, allowNull: true },
      location: { type: Sequelize.STRING, allowNull: true },
      unit_id: { type: Sequelize.STRING, allowNull: true },
      integration_mode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'backend_decides' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_devices', ['tenant_key', 'type', 'status'], {
      name: 'access_devices_tenant_type_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_devices', ['tenant_key', 'unit_id'], {
      name: 'access_devices_tenant_unit_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_decisions', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      device_id: { type: Sequelize.STRING, allowNull: true },
      credential_id: { type: Sequelize.STRING, allowNull: true },
      action: { type: Sequelize.STRING, allowNull: false, defaultValue: 'enter' },
      decision: { type: Sequelize.STRING, allowNull: false },
      reason_code: { type: Sequelize.STRING, allowNull: false },
      reason_detail: { type: Sequelize.TEXT, allowNull: true },
      issued_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      signature: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_decisions', ['tenant_key', 'issued_at'], {
      name: 'access_decisions_tenant_issued_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_decisions', ['tenant_key', 'subject_id', 'issued_at'], {
      name: 'access_decisions_tenant_subject_issued_idx',
    });

    await createTableIfNotExists(queryInterface, 'access_events', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      device_id: { type: Sequelize.STRING, allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      credential_id: { type: Sequelize.STRING, allowNull: true },
      decision_id: { type: Sequelize.STRING, allowNull: true },
      event_type: { type: Sequelize.STRING, allowNull: false },
      direction: { type: Sequelize.STRING, allowNull: true },
      reason_code: { type: Sequelize.STRING, allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'access_events', ['tenant_key', 'occurred_at'], {
      name: 'access_events_tenant_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_events', ['tenant_key', 'subject_id', 'occurred_at'], {
      name: 'access_events_tenant_subject_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'access_events', ['tenant_key', 'device_id', 'occurred_at'], {
      name: 'access_events_tenant_device_occurred_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('access_events');
    await queryInterface.dropTable('access_decisions');
    await queryInterface.dropTable('access_devices');
    await queryInterface.dropTable('access_policies');
    await queryInterface.dropTable('access_credentials');
    await queryInterface.dropTable('access_memberships');
    await queryInterface.dropTable('access_subjects');
  },
};
