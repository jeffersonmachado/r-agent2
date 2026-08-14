/**
 * Migration: schedule for execution jobs retention (prune done/dead).
 *
 * Jobs finalizados (`done`) e mortos (`dead`) não tinham retenção automática,
 * acumulando sem limite e derrubando o check `executionQueue` do selftest
 * (`dead >= SELFTEST_EXEC_QUEUE_DEAD_FAIL`). Este schedule roda diariamente.
 */

'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-prune-execution-jobs',
        tenant_key: 'system',
        name: 'Prune execution jobs (done/dead)',
        enabled: true,
        kind: 'prune_execution_jobs',
        payload: JSON.stringify({}),
        interval_sec: 86400,
        next_run_at: in10,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('schedules', { id: 'sch-prune-execution-jobs' }).catch(() => {});
  },
};
