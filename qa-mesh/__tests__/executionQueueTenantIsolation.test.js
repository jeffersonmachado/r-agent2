'use strict';

/**
 * R1 (LRO Fase 0 — docs/architecture/lro-qa-waves.md §3.1): a trava de execução única do
 * QA Waves/Mesh é GLOBAL, não por tenant.
 *
 * `enqueueExecution` (qa-mesh/executionQueue.js:127) chama `getActiveExecution()` (:118), que varre
 * `executions.values()` sem filtro de tenant. Medido no código: a onda em execução do tenant A faz o
 * enqueue do tenant B falhar com `EXECUTION_ALREADY_RUNNING`. É indisponibilidade CRUZADA entre
 * clientes — o payload de B não tem relação nenhuma com A.
 *
 * Este teste fixa o comportamento CORRETO: a exclusão mútua é por tenant. Enquanto a correção não
 * existir, ele falha (é o teste que deve nascer vermelho).
 */

const {
  enqueueExecution,
  clearExecutions,
  getAllExecutions,
} = require('../executionQueue');

const umaExecucaoQueNaoTermina = () => new Promise(() => {});

describe('R1 — execução única do QA Waves é POR TENANT, não global', () => {
  afterEach(() => {
    clearExecutions();
  });

  test('tenant B pode enfileirar enquanto o tenant A executa', () => {
    clearExecutions();

    const a = enqueueExecution('run', { tenantId: 'tenant-a', scenarioIds: ['s1'] }, umaExecucaoQueNaoTermina);
    expect(a.status).toBe('queued');

    expect(() => enqueueExecution('run', { tenantId: 'tenant-b', scenarioIds: ['s2'] }, umaExecucaoQueNaoTermina))
      .not.toThrow();
  });

  test('o MESMO tenant continua protegido contra duas ondas simultâneas', () => {
    clearExecutions();

    enqueueExecution('run', { tenantId: 'tenant-a', scenarioIds: ['s1'] }, umaExecucaoQueNaoTermina);

    expect(() => enqueueExecution('run', { tenantId: 'tenant-a', scenarioIds: ['s2'] }, umaExecucaoQueNaoTermina))
      .toThrow(/em andamento/i);
  });

  test('a mensagem de erro não revela execução de OUTRO tenant', () => {
    clearExecutions();

    const a = enqueueExecution('run', { tenantId: 'tenant-a', scenarioIds: ['s1'] }, umaExecucaoQueNaoTermina);
    try {
      enqueueExecution('run', { tenantId: 'tenant-a', scenarioIds: ['s2'] }, umaExecucaoQueNaoTermina);
      throw new Error('deveria ter lançado');
    } catch (erro) {
      expect(erro.code).toBe('EXECUTION_ALREADY_RUNNING');
      // O id ativo é do MESMO tenant; nunca de outro.
      expect(erro.activeExecutionId).toBe(a.executionId);
    }

    // E o isolamento de leitura se mantém: cada tenant só enxerga as suas.
    expect(getAllExecutions(50, { tenantId: 'tenant-a' }).every((r) => r.payload.tenantId === 'tenant-a')).toBe(true);
    expect(getAllExecutions(50, { tenantId: 'tenant-b' })).toHaveLength(0);
  });
});
