'use strict';

/**
 * Migration: execution_jobs + schedules (interval-based scheduler v1)
 *
 * This is a minimal, DB-first execution queue and scheduler to avoid coupling
 * to the outbound queue (which is product-specific).
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'execution_jobs', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      kind: { type: Sequelize.STRING(80), allowNull: false }, // scan_sla|prune_event_ledger|...
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' }, // pending|processing|done|failed|dead
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 5 },
      next_attempt_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      processing_at: { type: Sequelize.DATE, allowNull: true },
      processing_by: { type: Sequelize.STRING(120), allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      idempotency_key: { type: Sequelize.STRING(160), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'execution_jobs', ['tenant_key', 'status', 'next_attempt_at'], {
      name: 'execution_jobs_tenant_status_next_attempt_idx',
    });
    await addIndexIfNotExists(queryInterface, 'execution_jobs', ['tenant_key', 'kind', 'idempotency_key'], {
      name: 'execution_jobs_tenant_kind_idempotency_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'schedules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      name: { type: Sequelize.STRING(128), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      kind: { type: Sequelize.STRING(80), allowNull: false }, // job kind
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      interval_sec: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      next_run_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_run_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'schedules', ['tenant_key', 'enabled', 'next_run_at'], {
      name: 'schedules_tenant_enabled_next_run_idx',
    });

    // Seed minimal operational schedules (best-effort).
    // - SLA scan every 60s
    // - Event ledger prune every 6h
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 1000);
    const in600 = new Date(now.getTime() + 10 * 60 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-sla-scan',
        tenant_key: 'system',
        name: 'SLA scan (orders/physical)',
        enabled: true,
        kind: 'scan_sla',
        payload: {},
        interval_sec: 60,
        next_run_at: in60,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'sch-prune-event-ledger',
        tenant_key: 'system',
        name: 'Prune event ledger',
        enabled: true,
        kind: 'prune_event_ledger',
        payload: {},
        interval_sec: 6 * 60 * 60,
        next_run_at: in600,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.dropTable('schedules');
    await queryInterface.dropTable('execution_jobs');
  },
};

