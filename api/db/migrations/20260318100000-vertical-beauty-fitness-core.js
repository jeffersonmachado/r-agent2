'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

/**
 * Migration: Vertical Beauty & Fitness core tables
 *
 * Creates:
 * - vertical_journey_events   – audit trail of journey steps (confirmations, reminders, no-show…)
 * - vertical_attendances      – presence records correlated with access decisions
 * - vertical_session_bundles  – packages/subscriptions with session balance (Beauty + optional Fitness)
 * - vertical_engagement_signals – low-frequency / inactivity signals per subject
 *
 * All tables are multi-tenant (tenant_key) and use JSONB metadata for extensibility.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── vertical_journey_events ──────────────────────────────────────────────
    await createTableIfNotExists(queryInterface, 'vertical_journey_events', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },           // 'beauty' | 'fitness'
      subject_id: { type: Sequelize.STRING, allowNull: true },          // AccessSubject.id
      customer_id: { type: Sequelize.STRING, allowNull: true },         // external customer ref
      membership_id: { type: Sequelize.STRING, allowNull: true },       // AccessMembership.id
      schedule_id: { type: Sequelize.STRING, allowNull: true },         // scheduleService or DB schedule
      event_type: { type: Sequelize.STRING, allowNull: false },         // see JOURNEY_EVENT_TYPES
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      channel: { type: Sequelize.STRING, allowNull: true },             // 'whatsapp'|'email'|'internal'|null
      triggered_by: { type: Sequelize.STRING, allowNull: true },        // 'scheduler'|'manual'|'event'
      correlation_id: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_journey_events', ['tenant_key', 'vertical', 'event_type'], {
      name: 'vje_tenant_vertical_type_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_journey_events', ['tenant_key', 'subject_id', 'occurred_at'], {
      name: 'vje_tenant_subject_date_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_journey_events', ['tenant_key', 'customer_id', 'occurred_at'], {
      name: 'vje_tenant_customer_date_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_journey_events', ['tenant_key', 'idempotency_key'], {
      name: 'vje_tenant_idempotency_key_idx',
      unique: true,
      where: {
        idempotency_key: {
          [Sequelize.Op.ne]: null,
        },
      },
    });

    // ── vertical_attendances ─────────────────────────────────────────────────
    await createTableIfNotExists(queryInterface, 'vertical_attendances', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: false },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      access_decision_id: { type: Sequelize.STRING, allowNull: true },  // correlate with AccessDecision
      unit_id: { type: Sequelize.STRING, allowNull: true },
      device_id: { type: Sequelize.STRING, allowNull: true },
      checked_in_at: { type: Sequelize.DATE, allowNull: true },
      checked_out_at: { type: Sequelize.DATE, allowNull: true },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: true },
      session_bundle_id: { type: Sequelize.STRING, allowNull: true },   // deducts session when beauty package
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'open' }, // open|completed|absent
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_attendances', ['tenant_key', 'subject_id', 'checked_in_at'], {
      name: 'va_tenant_subject_checkin_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_attendances', ['tenant_key', 'membership_id', 'checked_in_at'], {
      name: 'va_tenant_membership_checkin_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_attendances', ['tenant_key', 'vertical', 'checked_in_at'], {
      name: 'va_tenant_vertical_checkin_idx',
    });

    // ── vertical_session_bundles ─────────────────────────────────────────────
    await createTableIfNotExists(queryInterface, 'vertical_session_bundles', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: false },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      bundle_type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'package' }, // 'package'|'subscription'
      plan_name: { type: Sequelize.STRING, allowNull: true },
      total_sessions: { type: Sequelize.INTEGER, allowNull: true },     // null = unlimited (subscription)
      used_sessions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' }, // active|exhausted|expired|cancelled
      billing_status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      start_at: { type: Sequelize.DATE, allowNull: true },
      end_at: { type: Sequelize.DATE, allowNull: true },
      due_date: { type: Sequelize.DATE, allowNull: true },
      renewal_at: { type: Sequelize.DATE, allowNull: true },
      grace_until: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_session_bundles', ['tenant_key', 'subject_id', 'status'], {
      name: 'vsb_tenant_subject_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_session_bundles', ['tenant_key', 'vertical', 'billing_status'], {
      name: 'vsb_tenant_vertical_billing_idx',
    });

    // ── vertical_engagement_signals ──────────────────────────────────────────
    await createTableIfNotExists(queryInterface, 'vertical_engagement_signals', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },
      subject_id: { type: Sequelize.STRING, allowNull: false },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      signal_type: { type: Sequelize.STRING, allowNull: false }, // 'low_frequency'|'inactive'|'no_show_risk'|'churn_risk'|'reactivation_candidate'
      score: { type: Sequelize.FLOAT, allowNull: true },                // 0.0 – 1.0 risk score
      last_attendance_at: { type: Sequelize.DATE, allowNull: true },
      days_since_last_visit: { type: Sequelize.INTEGER, allowNull: true },
      frequency_last_30d: { type: Sequelize.INTEGER, allowNull: true }, // visit count in last 30 days
      action_taken: { type: Sequelize.STRING, allowNull: true },        // 'notified'|'blocked'|'reactivated'|null
      action_taken_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      computed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'vertical_engagement_signals', ['tenant_key', 'subject_id', 'signal_type'], {
      name: 'ves_tenant_subject_signal_idx',
    });
    await addIndexIfNotExists(queryInterface, 'vertical_engagement_signals', ['tenant_key', 'vertical', 'signal_type', 'computed_at'], {
      name: 'ves_tenant_vertical_signal_date_idx',
    });

    // ── access_memberships extended columns ──────────────────────────────────
    // Add billing time columns to existing access_memberships (idempotent via try/catch)
    const columnsToAdd = [
      { name: 'due_date', type: Sequelize.DATE },
      { name: 'renewal_at', type: Sequelize.DATE },
      { name: 'grace_until', type: Sequelize.DATE },
      { name: 'plan_type', type: Sequelize.STRING },
    ];
    for (const col of columnsToAdd) {
      try {
        await queryInterface.addColumn('access_memberships', col.name, {
          type: col.type,
          allowNull: true,
          defaultValue: null,
        });
      } catch (_) {
        // column already exists – safe to ignore
      }
    }
  },

  async down(queryInterface) {
    for (const tbl of [
      'vertical_engagement_signals',
      'vertical_session_bundles',
      'vertical_attendances',
      'vertical_journey_events',
    ]) {
      await queryInterface.dropTable(tbl).catch(() => {});
    }
    for (const col of ['due_date', 'renewal_at', 'grace_until', 'plan_type']) {
      await queryInterface.removeColumn('access_memberships', col).catch(() => {});
    }
  },
};
