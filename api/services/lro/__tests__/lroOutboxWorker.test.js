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
const { serializarOperacao } = require('../lroService');

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

  // REGRESSÃO MEDIDA EM PRODUÇÃO-LOCAL (2026-10-31): o publicador lia `operacao.tenant_id`, mas a
  // operação chega serializada pelo contrato público (`serializarOperacao` → camelCase). Com o
  // contrato unificado, TODO evento passou a morrer com `TENANT_NAO_RESOLVIDO` (5 linhas DEAD no
  // outbox real). O fixture aqui é construído PELO SERIALIZADOR — fixture escrita à mão mascarou o
  // defeito porque o mock devolvia o shape antigo.
  // A varredura de feedback vencido roda no MESMO tick do outbox (não há segundo mecanismo). Ela é
  // isolada: falha dela não pode parar o dreno da outbox nem derrubar o worker.
  test('tick também roda a varredura de prazos, sem depender dela', async () => {
    const dispatch = jest.fn(async () => ({ publicados: 2, reagendados: 0, mortos: 0 }));
    const sweep = jest.fn(async () => ({ expirados: 1 }));
    const worker = criarWorker({
      dispatch, publish: async () => {}, sweep,
      setIntervalFn: () => ({ unref: jest.fn() }), clearIntervalFn: jest.fn(),
    });

    const r = await worker.tick();
    expect(dispatch).toHaveBeenCalled();
    expect(sweep).toHaveBeenCalled();
    expect(r.publicados).toBe(2);
  });

  // P1-C (prompt duro 2026-10-31): a varredura rodava DEPOIS de `dispatch()` no mesmo try — se a
  // outbox falhasse, o prazo de decisão humana NUNCA era avaliado (starvation). As duas
  // responsabilidades precisam ser isoladas nas DUAS direções.
  test('falha PERSISTENTE do dispatch não impede a varredura de rodar a cada ciclo', async () => {
    const dispatch = jest.fn(async () => { throw Object.assign(new Error('db down'), { code: 'DISPATCH_FALHOU' }); });
    const sweep = jest.fn(async () => ({ expirados: 0 }));
    const worker = criarWorker({
      dispatch, publish: async () => {}, sweep,
      setIntervalFn: () => ({ unref: jest.fn() }), clearIntervalFn: jest.fn(),
    });

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  test('resultado do ciclo distingue falha de dispatch e desfecho da varredura', async () => {
    const dispatch = jest.fn(async () => { throw Object.assign(new Error('db down'), { code: 'DISPATCH_FALHOU' }); });
    const sweep = jest.fn(async () => ({ expirados: 2 }));
    const worker = criarWorker({
      dispatch, publish: async () => {}, sweep,
      setIntervalFn: () => ({ unref: jest.fn() }), clearIntervalFn: jest.fn(),
    });

    const r = await worker.tick();
    expect(r.dispatchError).toMatchObject({ code: 'DISPATCH_FALHOU' });
    expect(r.sweep).toMatchObject({ expirados: 2 });
  });

  test('flag desligada: worker não agenda ciclo (não há expiração automática sem executor)', async () => {
    const sweep = jest.fn();
    const agendar = jest.fn(() => ({ unref: jest.fn() }));
    const worker = criarWorker({
      dispatch: async () => ({}), publish: async () => {}, sweep,
      setIntervalFn: agendar, clearIntervalFn: jest.fn(), habilitado: false,
    });
    const r = worker.start();
    expect(r.started).toBe(false);
    expect(agendar).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  test('falha da varredura NÃO impede a outbox de drenar', async () => {
    const dispatch = jest.fn(async () => ({ publicados: 3, reagendados: 0, mortos: 0 }));
    const sweep = jest.fn(async () => { throw Object.assign(new Error('boom'), { code: 'SWEEP_FALHOU' }); });
    const worker = criarWorker({
      dispatch, publish: async () => {}, sweep,
      setIntervalFn: () => ({ unref: jest.fn() }), clearIntervalFn: jest.fn(),
    });

    const r = await worker.tick();
    expect(r.publicados).toBe(3);
  });

  function operacaoSerializada(extra = {}) {
    return serializarOperacao({ id: 'op-1', tenant_id: 'system', status: 'RUNNING', ...extra });
  }

  test('publicador WebSocket: publica para o TENANT da operação', async () => {
    const broadcastToTenant = jest.fn();
    const publicar = criarPublicadorWebSocket({
      broadcastToTenant,
      obterOperacao: async () => operacaoSerializada(),
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
      obterOperacao: async () => operacaoSerializada({ tenant_id: null }),
    });
    await expect(publicar('lro.events', { operationId: 'op-2', seq: 1 }))
      .rejects.toMatchObject({ code: 'TENANT_NAO_RESOLVIDO' });
    expect(broadcastToTenant).not.toHaveBeenCalled();
  });
});
