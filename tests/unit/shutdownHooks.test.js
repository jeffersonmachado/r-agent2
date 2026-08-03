'use strict';

describe('registerShutdownHooks - shutdown gracioso', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeProcessRef() {
    const handlers = {};
    return {
      handlers,
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      exit: jest.fn(),
    };
  }

  test('para workers, salva sessões e fecha o servidor antes do exit', () => {
    const { registerShutdownHooks } = require('../../api/runtime/registerShutdownHooks');

    const processRef = makeProcessRef();
    const stopWorkers = jest.fn();
    const saveSessionEventsToFileImmediate = jest.fn();
    const server = { close: jest.fn((cb) => cb()) };

    registerShutdownHooks({
      logger: { info: jest.fn(), warn: jest.fn() },
      outboundWorker: { stop: jest.fn() },
      saveSessionEventsToFileImmediate,
      stopWorkers,
      getServer: () => server,
      processRef,
    });

    processRef.handlers.SIGTERM();

    expect(stopWorkers).toHaveBeenCalledTimes(1);
    expect(saveSessionEventsToFileImmediate).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(0);
  });

  test('força exit após timeout se server.close não completar', () => {
    jest.useFakeTimers();
    const { registerShutdownHooks } = require('../../api/runtime/registerShutdownHooks');

    const processRef = makeProcessRef();
    const server = { close: jest.fn(() => {}) }; // nunca chama o callback

    registerShutdownHooks({
      logger: { info: jest.fn(), warn: jest.fn() },
      outboundWorker: null,
      saveSessionEventsToFileImmediate: jest.fn(),
      stopWorkers: jest.fn(),
      getServer: () => server,
      forceExitTimeoutMs: 10000,
      processRef,
    });

    processRef.handlers.SIGINT();
    expect(processRef.exit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10000);
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });

  test('sem servidor registrado, sai imediatamente (compatibilidade)', () => {
    const { registerShutdownHooks } = require('../../api/runtime/registerShutdownHooks');

    const processRef = makeProcessRef();
    const saveSessionEventsToFileImmediate = jest.fn();

    registerShutdownHooks({
      logger: { info: jest.fn() },
      outboundWorker: { stop: jest.fn() },
      saveSessionEventsToFileImmediate,
      processRef,
    });

    processRef.handlers.SIGINT();

    expect(saveSessionEventsToFileImmediate).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(0);
  });
});

describe('startWorkers/stopWorkers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('stopWorkers para o outbound worker e limpa o intervalo de cleanup de tickets', () => {
    const { startWorkers, stopWorkers } = require('../../api/runtime/startWorkers');

    const outboundWorker = { start: jest.fn(), stop: jest.fn() };
    const startAutoCleanup = jest.fn().mockReturnValue('interval-ticket-cleanup');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const logger = { info: jest.fn(), warn: jest.fn() };

    startWorkers({
      logger,
      outboundWorker,
      startAutoCleanup,
      startAutoReturnToBot: jest.fn(),
      startAssignmentWorker: jest.fn(),
      processRef: {
        env: {
          ENABLE_PLAYWRIGHT_BOOT_CHECK: 'false',
          ENABLE_WHATSAPP_QR_BRIDGE: 'false',
          ENABLE_OUTBOUND_WORKER: 'false',
          ENABLE_AUTO_RETURN_TO_BOT: 'false',
          ENABLE_ASSIGNMENT_WORKER: 'false',
          ENABLE_EXECUTION_QUEUE_WORKER: 'false',
          ENABLE_SCHEDULER: 'false',
          ENABLE_VERTICAL_SCHEDULER: 'false',
          ENABLE_CHANNEL_HEALTH_MONITOR: 'false',
          ENABLE_MARKETING_GOOGLE_ADS_SCHEDULER: 'false',
        },
      },
    });

    expect(startAutoCleanup).toHaveBeenCalledTimes(1);

    stopWorkers();

    expect(outboundWorker.stop).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith('interval-ticket-cleanup');

    clearIntervalSpy.mockRestore();
  });
});
