'use strict';

/**
 * Regressao do incidente de 2026-10-01: a API morria INTEIRA por uma promise
 * rejeitada sem catch dentro do `whatsapp-web.js` (puppeteer/CDP), derrubando
 * todos os tenants e abortando o converge/mesh do pipeline de release no meio
 * (o mesh ficou 1h pendurado esperando a API que ja nao existia).
 *
 * O runtime do servidor precisa: registrar a rejeicao com stack e MANTER o
 * processo vivo (integracao opcional nao pode matar a plataforma) e, para
 * excecao nao capturada, registrar antes de encerrar.
 */

const EventEmitter = require('events');
const { startServerRuntime } = require('../../api/runtime/startServerRuntime');

function makeProcessRef() {
  const emitter = new EventEmitter();
  emitter.exit = jest.fn();
  return emitter;
}

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

async function boot({ processRef, logger }) {
  const server = { listen: jest.fn((_port, cb) => { if (cb) cb(); }) };
  await startServerRuntime({
    logger,
    clearLimitersCache: jest.fn(),
    startInitialization: async () => {},
    getOrCreateServer: () => server,
    port: 0,
    startWorkers: jest.fn(),
    workerDeps: {},
    processRef,
  });
  return server;
}

describe('startServerRuntime — isolamento de falhas de processo', () => {
  test('REGRESSAO: rejeicao nao tratada NAO mata o processo e e registrada', async () => {
    const processRef = makeProcessRef();
    const logger = makeLogger();
    await boot({ processRef, logger });

    expect(processRef.listenerCount('unhandledRejection')).toBe(1);

    processRef.emit('unhandledRejection', new Error('await res.text() do bridge caiu'));

    expect(processRef.exit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.error.mock.calls[0];
    expect(String(message)).toContain('unhandledRejection');
    expect(meta.message).toBe('await res.text() do bridge caiu');
    expect(meta.stack).toEqual(expect.stringContaining('await res.text() do bridge caiu'));
    expect(meta.count).toBe(1);
  });

  test('conta rejeicoes repetidas (observabilidade, sem parar o servico)', async () => {
    const processRef = makeProcessRef();
    const logger = makeLogger();
    await boot({ processRef, logger });

    processRef.emit('unhandledRejection', new Error('primeira'));
    processRef.emit('unhandledRejection', new Error('segunda'));

    expect(processRef.exit).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[1][1].count).toBe(2);
  });

  test('rejeicao nao-Error e registrada como string', async () => {
    const processRef = makeProcessRef();
    const logger = makeLogger();
    await boot({ processRef, logger });

    processRef.emit('unhandledRejection', 'falha crua');

    expect(logger.error.mock.calls[0][1].message).toBe('falha crua');
    expect(processRef.exit).not.toHaveBeenCalled();
  });

  test('uncaughtException registra e encerra com codigo 1', async () => {
    const processRef = makeProcessRef();
    const logger = makeLogger();
    await boot({ processRef, logger });

    expect(processRef.listenerCount('uncaughtException')).toBe(1);
    processRef.emit('uncaughtException', new Error('estado indefinido'));

    expect(logger.error).toHaveBeenCalled();
    expect(String(logger.error.mock.calls[0][0])).toContain('uncaughtException');
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });

  test('falha do logger nao propaga (handler nunca derruba o processo)', async () => {
    const processRef = makeProcessRef();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(() => { throw new Error('logger quebrado'); }),
    };
    await boot({ processRef, logger });

    expect(() => processRef.emit('unhandledRejection', new Error('x'))).not.toThrow();
    expect(processRef.exit).not.toHaveBeenCalled();
  });
});
