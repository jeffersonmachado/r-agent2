'use strict';

/**
 * Regressão do incidente 2026-09-11 (fila `execution_jobs` → saturação do
 * Postgres → login da API em timeout).
 *
 * Duas causas cobertas aqui:
 * 1. `claimNextJobs` sem lote: o worker reivindicava 1 job por tick (800ms),
 *    vazão presa em ~1,25 job/s, abaixo da taxa de enfileiramento.
 * 2. Query de claim sem índice utilizável (coberta pela migration
 *    `20260911000000-execution-jobs-claim-indexes.js`): a varredura completa
 *    fazia cada claim levar segundos.
 *
 * Prova: o claim aceita lote com teto, o worker drena vários lotes por tick e
 * o tick nunca sobrepõe execuções.
 */

function loadQueue({ jobsPerClaim = 1, totalJobs = 1, claimCalls = [] } = {}) {
  jest.resetModules();

  let delivered = 0;
  const sequelizeQuery = jest.fn(async (sql) => {
    const text = String(sql);
    claimCalls.push(text);
    if (text.includes('FOR UPDATE SKIP LOCKED')) {
      if (delivered >= totalJobs) return [[]];
      const remaining = totalJobs - delivered;
      const size = Math.min(jobsPerClaim, remaining);
      const rows = Array.from({ length: size }, (_, i) => ({
        id: `job-${delivered + i}`,
        kind: 'scan_sla',
        tenant_key: 'tenant-a',
        attempts: 0,
        max_attempts: 3,
      }));
      delivered += size;
      return [rows];
    }
    return [[]];
  });

  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({ query: sequelizeQuery }) }));
  jest.doMock('../../api/db/models', () => ({ ExecutionJob: () => ({ create: jest.fn(async (row) => row) }) }));
  jest.doMock('../../infra/rate-limit', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }));
  jest.doMock('../../api/services/opsSlaService', () => ({ runSlaScan: jest.fn(async () => ({})) }));

  // eslint-disable-next-line global-require
  const svc = require('../../api/services/executionQueueService');
  return { svc, sequelizeQuery, claimCalls };
}

describe('claimNextJobs — claim em lote', () => {
  test('respeita o batchSize pedido e devolve todos os jobs do lote', async () => {
    const { svc, claimCalls } = loadQueue({ jobsPerClaim: 5, totalJobs: 5 });
    const jobs = await svc.claimNextJobs({ batchSize: 5 });

    expect(jobs).toHaveLength(5);
    const claimSql = claimCalls.find((s) => s.includes('FOR UPDATE SKIP LOCKED'));
    expect(claimSql).toContain('LIMIT :batch');
  });

  test('limita o lote ao teto duro (200) mesmo com configuração absurda', async () => {
    const { svc, sequelizeQuery } = loadQueue({ jobsPerClaim: 1, totalJobs: 1 });
    await svc.claimNextJobs({ batchSize: 100000 });

    const [, opts] = sequelizeQuery.mock.calls[0];
    expect(opts.replacements.batch).toBe(200);
  });

  test('claimNextJob (compat) continua devolvendo um job', async () => {
    const { svc } = loadQueue({ jobsPerClaim: 1, totalJobs: 1 });
    const job = await svc.claimNextJob();
    expect(job).toMatchObject({ id: 'job-0' });
  });

  test('fila vazia ⇒ array vazio (sem job fantasma)', async () => {
    const { svc } = loadQueue({ jobsPerClaim: 1, totalJobs: 0 });
    await expect(svc.claimNextJobs({ batchSize: 10 })).resolves.toEqual([]);
  });
});

describe('worker — drenagem em lotes', () => {
  test('drena vários jobs por tick quando a fila está cheia', async () => {
    const { svc } = loadQueue({ jobsPerClaim: 10, totalJobs: 30 });

    svc.startExecutionQueueWorker({ intervalMs: 200, batchSize: 10, budgetMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    svc.stopExecutionQueueWorker();

    // Antes o worker processava 1 job por tick; agora drena o backlog inteiro.
    const processed = loadQueueState();
    expect(processed).toBeGreaterThan(1);
  });

  test('stopExecutionQueueWorker interrompe a drenagem', async () => {
    const { svc } = loadQueue({ jobsPerClaim: 10, totalJobs: 1000 });
    svc.startExecutionQueueWorker({ intervalMs: 200, batchSize: 10, budgetMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    svc.stopExecutionQueueWorker();
    const after = loadQueueState();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(loadQueueState()).toBe(after);
  });
});

// Contador de jobs concluídos observável pelo teste (o mock de opsSlaService
// registra cada execução).
function loadQueueState() {
  // eslint-disable-next-line global-require
  const sla = require('../../api/services/opsSlaService');
  return sla.runSlaScan.mock.calls.length;
}
