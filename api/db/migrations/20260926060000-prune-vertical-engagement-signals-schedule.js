/**
 * Migration: schedule for vertical engagement signals retention (prune).
 *
 * DEFEITO (medido 2026-09-26): `vertical_engagement_signals` acumulava sem
 * limite — 8.412.206 linhas / ~4,1 GB cobrindo 6 meses, com 96,5% das linhas
 * acima de 30 dias. Era a ÚNICA tabela derivada sem expurgo: as outras três já
 * tinham o seu (`prune_event_ledger`, `prune_flow_execution_ledger`,
 * `prune_execution_jobs`).
 *
 * Consequência medida: a varredura incremental dos `vertical_*_journey_tick`
 * fazia Seq Scan sobre 8,4M linhas (3.141 ms/execução, ~2,9 GB lidos),
 * estourava o orçamento do tick (`processed: 2, total: 500, elapsedMs: 79371`)
 * e saturava o processo, causando timeout em requisições de cliente e flake do
 * QA Mesh (`fitness-matricula-leads`).
 *
 * Retenção padrão de 90 dias (3× a janela padrão de 30 dias dos dashboards),
 * ajustável por `VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS`. Roda diariamente,
 * como os demais expurgos.
 */

'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 1000);
    await queryInterface.bulkInsert('schedules', [
      {
        id: 'sch-prune-vertical-engagement-signals',
        tenant_key: 'system',
        name: 'Prune vertical engagement signals (derived cache)',
        enabled: true,
        kind: 'prune_vertical_engagement_signals',
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
    await queryInterface.bulkDelete('schedules', { id: 'sch-prune-vertical-engagement-signals' }).catch(() => {});
  },
};
