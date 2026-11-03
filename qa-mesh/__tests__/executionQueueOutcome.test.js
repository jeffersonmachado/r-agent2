'use strict';

/**
 * P1-G (prompt duro 2026-10-31): a fila do QA Mesh presumia SUCESSO quando o resumo não dizia
 * `NO_GO`:
 *
 *     status: result?.summary?.goNoGo === 'NO_GO' ? 'failed' : 'completed'
 *     progress: 100
 *
 * Consequências medidas: runner que devolve `undefined`, `summary` ausente, `SKIPPED`,
 * `NOT_EXECUTED` ou `UNKNOWN` produzia execução `completed` com **100% de progresso** — sucesso
 * presumido a partir da AUSÊNCIA de evidência. Só `GO` explícito pode concluir; progresso
 * desconhecido não é 100%.
 */

const { enqueueExecution, clearExecutions, getExecution } = require('../executionQueue');

const esperar = async (executionId, tentativas = 60) => {
  for (let i = 0; i < tentativas; i += 1) {
    const exec = getExecution(executionId);
    if (exec && exec.status !== 'queued' && exec.status !== 'running') return exec;
    await new Promise((r) => setTimeout(r, 10));
  }
  return getExecution(executionId);
};

const rodarCom = async (resultado) => {
  clearExecutions();
  const { executionId } = enqueueExecution('run', { tenantId: 'tenant-p1g' }, async () => resultado);
  return esperar(executionId);
};

describe('P1-G — conclusão do QA Mesh exige evidência explícita de GO', () => {
  afterEach(() => clearExecutions());

  test('summary.goNoGo = GO ⇒ completed com 100%', async () => {
    const exec = await rodarCom({ summary: { goNoGo: 'GO' }, results: [] });
    expect(exec.status).toBe('completed');
    expect(exec.progress).toBe(100);
  });

  test('summary.goNoGo = NO_GO ⇒ failed', async () => {
    const exec = await rodarCom({ summary: { goNoGo: 'NO_GO' }, results: [] });
    expect(exec.status).toBe('failed');
  });

  test.each([
    ['runner devolve undefined', undefined],
    ['summary ausente', { results: [] }],
    ['goNoGo SKIPPED', { summary: { goNoGo: 'SKIPPED' } }],
    ['goNoGo NOT_EXECUTED', { summary: { goNoGo: 'NOT_EXECUTED' } }],
    ['goNoGo UNKNOWN', { summary: { goNoGo: 'UNKNOWN' } }],
    ['goNoGo vazio', { summary: { goNoGo: '' } }],
  ])('%s ⇒ NÃO pode concluir como completed nem marcar 100%%', async (_nome, resultado) => {
    const exec = await rodarCom(resultado);
    expect(exec.status).not.toBe('completed');
    expect(exec.progress).not.toBe(100);
  });

  test('motivo da recusa fica registrado (não é falha silenciosa)', async () => {
    const exec = await rodarCom({ summary: { goNoGo: 'SKIPPED' } });
    const texto = JSON.stringify(exec);
    expect(texto).toMatch(/SKIPPED|GONOGO|SEM_SUMMARY/i);
  });
});
