/**
 * Migration: schedule for flow execution ledger pruning
 */

'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-flow-exec-ledger-prune',
        tenant_key: 'system',
        name: 'Prune flow execution ledger',
        enabled: true,
        kind: 'prune_flow_execution_ledger',
        payload: JSON.stringify({}),
        interval_sec: 3600,
        next_run_at: in10,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('schedules', { id: 'sch-flow-exec-ledger-prune' }).catch(() => {});
  },
};
