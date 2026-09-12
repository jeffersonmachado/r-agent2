'use strict';

/**
 * Migration: índices de claim da execution_jobs.
 *
 * Incidente operacional (2026-09-11): a fila acumulou ~277k jobs `pending` e o
 * Postgres ficou saturado, fazendo o login da API estourar timeout (o worker
 * reivindica um job por tick e cada claim levava segundos).
 *
 * Causa: `claimNextJobs` (api/services/executionQueueService.js) filtra apenas
 * `status='pending' AND next_attempt_at <= NOW()` — SEM `tenant_key` — e avalia
 * uma subquery correlacionada por `tenant_key`/`processing_at` com
 * `status='processing'`. O índice existente é `(tenant_key, status,
 * next_attempt_at)`, que não é utilizável sem filtro/ordenação por tenant_key,
 * então o plano caía em varredura completa da tabela (1M+ linhas) a cada claim.
 *
 * Esta migration cria dois índices PARCIAIS que cobrem exatamente as duas
 * leituras do claim:
 * - `execution_jobs_claim_idx`: fila pendente ordenada por priority/next_attempt_at.
 * - `execution_jobs_processing_tenant_idx`: contagem de concorrência por tenant.
 *
 * Ambos usam `CREATE INDEX CONCURRENTLY` (fora de transação) para não bloquear
 * escritas na fila durante a criação; em ambientes onde o runner da migration
 * envolve tudo em transação, cai para criação normal (best-effort).
 */

const CLAIM_INDEX = 'execution_jobs_claim_idx';
const PROCESSING_INDEX = 'execution_jobs_processing_tenant_idx';
const TABLE = 'execution_jobs';

async function hasIndex(queryInterface, indexName) {
  try {
    const indexes = await queryInterface.showIndex(TABLE);
    return Array.isArray(indexes) && indexes.some((idx) => idx && idx.name === indexName);
  } catch (_) {
    return false;
  }
}

async function createPartialIndex(queryInterface, indexName, definition) {
  if (await hasIndex(queryInterface, indexName)) return;
  const sequelize = queryInterface.sequelize;
  try {
    await sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${TABLE} ${definition}`);
  } catch (_) {
    // `CREATE INDEX CONCURRENTLY` não roda dentro de transação e pode deixar
    // índice inválido em caso de falha; o caminho padrão é idempotente.
    await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${TABLE} ${definition}`);
  }
}

module.exports = {
  async up(queryInterface) {
    await createPartialIndex(
      queryInterface,
      CLAIM_INDEX,
      `(priority DESC, next_attempt_at ASC) WHERE status = 'pending'`,
    );

    await createPartialIndex(
      queryInterface,
      PROCESSING_INDEX,
      `(tenant_key, processing_at) WHERE status = 'processing'`,
    );

    // Estatísticas do planejador alinhadas com a tabela: aumenta a chance de o
    // plano escolher os índices parciais logo após criar/limpar backlog.
    try {
      await queryInterface.sequelize.query(`ANALYZE ${TABLE}`);
    } catch (_) { /* best-effort */ }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${CLAIM_INDEX}`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${PROCESSING_INDEX}`);
  },
};
