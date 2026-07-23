'use strict';

/**
 * Seed do schedule do ciclo adaptativo do Learning Core (a cada 6h):
 * sinais de drift + reavaliação de certificações + recompute das
 * competências dos usuários ativos nas últimas 24h. Idempotente.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const next = new Date(now.getTime() + 10 * 60 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-learning-adaptive-cycle',
        tenant_key: 'system',
        name: 'Learning Core: ciclo adaptativo (drift + recompute)',
        enabled: true,
        kind: 'learning_adaptive_cycle',
        payload: JSON.stringify({}),
        interval_sec: 6 * 60 * 60,
        next_run_at: next,
        last_run_at: null,
        created_at: now,
        updated_at: now,
      },
    ]).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('schedules', { id: 'sch-learning-adaptive-cycle' }).catch(() => {});
  },
};
