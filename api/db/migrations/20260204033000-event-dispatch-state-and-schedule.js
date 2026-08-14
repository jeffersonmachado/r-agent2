/**
 * Migration: event dispatch cursor + schedule
 *
 * - event_dispatch_state: cursor for scanning event_ledger
 * - schedule: scan_event_triggers every few seconds (system)
 */
 
'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'event_dispatch_state', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true }, // consumer key
      consumer: { type: Sequelize.STRING(80), allowNull: false },
      last_received_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal(`'1970-01-01'::timestamptz`) },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'event_dispatch_state', ['consumer'], {
      name: 'event_dispatch_state_consumer_uq',
      unique: true,
    });

    // Seed schedule (best-effort)
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-event-ledger-dispatch',
        tenant_key: 'system',
        name: 'Dispatch event_ledger triggers',
        enabled: true,
        kind: 'scan_event_triggers',
        payload: JSON.stringify({ consumer: 'webhooks_v1', batchSize: 100 }),
        interval_sec: 5,
        next_run_at: in10,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('schedules', { id: 'sch-event-ledger-dispatch' }).catch(() => {});
    await queryInterface.dropTable('event_dispatch_state');
  },
};

