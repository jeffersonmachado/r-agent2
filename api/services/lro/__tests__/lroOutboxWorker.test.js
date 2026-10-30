'use strict';

/**
 * Worker da outbox — contrato com agenda INJETADA (nenhum timer real no teste).
 *
 * Fixa o que importa: opt-in por flag, tick não reentrante, falha de publicação não derruba,
 * publicador WebSocket fail-closed sem tenant.
 */

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

const {
  criarWorker, criarPublicadorWebSocket, workerHabilitado, FLAG,
} = require('../lroOutboxWorker');

describe('worker da outbox de LRO', () => {
  const envOriginal = process.env[FLAG];
  afterEach(() => {
    if (envOriginal === undefined) delete process.env[FLAG];
    else process.env[FLAG] = envOriginal;
    jest.clearAllMocks();
  });

  test('flag desligada (default) não inicia', () => {
    delete process.env[FLAG];
    expect(workerHabilitado()).toBe(false);
    const worker = criarWorker({ dispatch: jest.fn(), publish: jest.fn() });
    expect(worker.start()).toMatchObject({ started: false });
    expect(worker.isRunning()).toBe(false);
  });

  test('flag ligada inicia e agenda com a função INJETADA', () => {
    process.env[FLAG] = '1';
    const agendador = jest.fn(() => ({ unref: jest.fn() }));
    const worker = criarWorker({ dispatch: jest.fn(), publish: jest.fn(), setIntervalFn: agendador, intervalMs: 250 });

    expect(worker.start()).toEqual({ started: true });
    expect(agendador).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(worker.start()).toMatchObject({ started: false, reason: 'ja_rodando' }); // idempotente
  });

  test('tick publica via dispatch e não é reentrante', async () => {
    const libera = [];
    const dispatch = jest.fn(() => new Promise((resolve) => { libera.push(resolve); }));
    const worker = criarWorker({ dispatch, publish: jest.fn(), habilitado: true });

    const primeiro = worker.tick();
    const segundo = await worker.tick(); // concorrente
    expect(segundo).toMatchObject({ skipped: true });

    libera[0]({ publicados: 1, reagendados: 0, mortos: 0, erros: [] });
    await expect(primeiro).resolves.toMatchObject({ publicados: 1 });
  });

  test('falha no ciclo NÃO derruba o worker (volta como resumo)', async () => {
    const dispatch = jest.fn().mockRejectedValue(Object.assign(new Error('db caiu'), { code: 'DB_DOWN' }));
    const worker = criarWorker({ dispatch, publish: jest.fn(), habilitado: true });

    const r = await worker.tick();
    expect(r).toMatchObject({ publicados: 0, reagendados: 0, mortos: 0 });
    expect(r.erros[0].message).toContain('db caiu');
  });

  test('stop é idempotente e limpa o timer', async () => {
    const limpar = jest.fn();
    const worker = criarWorker({
      dispatch: jest.fn(), publish: jest.fn(), habilitado: true,
      setIntervalFn: () => ({ unref: jest.fn() }), clearIntervalFn: limpar,
    });
    worker.start();
    expect((await worker.stop()).stopped).toBe(true);
    expect(limpar).toHaveBeenCalled();
    expect((await worker.stop()).stopped).toBe(false);
  });

  test('publicador WebSocket: publica para o TENANT da operação', async () => {
    const broadcastToTenant = jest.fn();
    const publicar = criarPublicadorWebSocket({
      broadcastToTenant,
      obterOperacao: async () => ({ tenant_id: 'system' }),
    });
    await publicar('lro.events', { operationId: 'op-1', seq: 7, type: 'PROGRESS' });
    expect(broadcastToTenant).toHaveBeenCalledWith('system', {
      type: 'lro.event', operationId: 'op-1', seq: 7, eventType: 'PROGRESS',
    });
  });

  test('publicador WebSocket é FAIL-CLOSED sem tenant (não vaza evento)', async () => {
    const broadcastToTenant = jest.fn();
    const publicar = criarPublicadorWebSocket({
      broadcastToTenant,
      obterOperacao: async () => ({ tenant_id: null }),
    });
    await expect(publicar('lro.events', { operationId: 'op-2', seq: 1 }))
      .rejects.toMatchObject({ code: 'TENANT_NAO_RESOLVIDO' });
    expect(broadcastToTenant).not.toHaveBeenCalled();
  });
});
