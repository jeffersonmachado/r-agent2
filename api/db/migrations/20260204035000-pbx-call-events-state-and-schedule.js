/**
 * Migration: PBX call events v0 (CDR-based) state + schedule.
 *
 * - pbx_call_event_state: cursor for scanning pbx_cdr
 * - schedule: scan_pbx_cdr_events every N seconds (system)
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'pbx_call_event_state', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true }, // single consumer key
      consumer: { type: Sequelize.STRING(80), allowNull: false },
      last_calldate: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal(`'1970-01-01'::timestamptz`) },
      last_cdr_id: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'pbx_call_event_state', ['consumer'], {
      name: 'pbx_call_event_state_consumer_uq',
      unique: true,
    });

    // Seed schedule (best-effort)
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-pbx-cdr-events',
        tenant_key: 'system',
        name: 'Emit PBX call events v0 (CDR scan)',
        enabled: true,
        kind: 'scan_pbx_cdr_events',
        payload: JSON.stringify({ consumer: 'pbx_cdr_v0', batchSize: 200 }),
        interval_sec: 10,
        next_run_at: in10,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('schedules', { id: 'sch-pbx-cdr-events' }).catch(() => {});
    await queryInterface.dropTable('pbx_call_event_state').catch(() => {});
  },
};

