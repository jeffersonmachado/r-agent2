'use strict';

/**
 * Retenção de `vertical_engagement_signals`.
 *
 * DEFEITO (medido 2026-09-26): a tabela crescia sem limite — 8.412.206 linhas /
 * ~4,1 GB, cobrindo 6 meses, com **96,5% das linhas acima de 30 dias**. Não havia
 * nenhum expurgo, enquanto as outras tabelas derivadas já tinham o seu
 * (`prune_event_ledger`, `prune_flow_execution_ledger`, `prune_execution_jobs` —
 * ver `api/services/executionQueueService.js`). Consequência medida: a varredura
 * incremental dos `vertical_*_journey_tick` fazia Seq Scan sobre 8,4M linhas
 * (3.141 ms por execução, ~2,9 GB lidos), estourava o orçamento do tick
 * (`processed: 2, total: 500, elapsedMs: 79371`) e saturava o processo — causando
 * timeout de requisições de cliente e flake do QA Mesh.
 *
 * SEGURANÇA DA RETENÇÃO: todos os leitores consultam uma JANELA RECENTE —
 * `handleFitnessRoutes`/`handleClinicRoutes` (`computed_at >= since`, default de
 * 30 dias), `handleFitnessStudentRoutes` (últimos 20, `computed_at DESC`) e
 * `fitnessChurnSignalService` (`computed_at >= since`). Nenhum leitor busca
 * "todos os sinais já calculados". O sinal é uma CACHE DERIVADA: cada linha é o
 * resultado de um recálculo (`computeEngagementSignal`), não um registro
 * contábil/fiscal.
 *
 * O default de 90 dias dá margem de 3× sobre a janela padrão de 30 dias dos
 * dashboards. Atenção: um cliente que peça `windowDays` MAIOR que a retenção vê
 * menos histórico — é o mesmo compromisso já aceito nos outros expurgos.
 * Ajustável por `VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS`.
 */

const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

async function pruneVerticalEngagementSignals({ retentionDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const days = retentionDays != null
    ? Number(retentionDays)
    : intEnv('VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS', 90);
  if (!Number.isFinite(days) || days <= 0) return { ok: false, reason: 'invalid_retention_days' };

  // Só `computed_at` importa: a linha é um recálculo datado. Não há estado
  // pendente/em processamento a preservar (diferente de execution_jobs).
  const [res] = await sequelize.query(
    `DELETE FROM vertical_engagement_signals
     WHERE computed_at < NOW() - INTERVAL '${Math.floor(days)} days'`,
  );

  return { ok: true, retentionDays: Math.floor(days), result: res || null };
}

module.exports = { pruneVerticalEngagementSignals };
