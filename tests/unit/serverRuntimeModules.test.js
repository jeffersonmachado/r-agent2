'use strict';

const path = require('path');

const sequelizePath = path.join(process.cwd(), 'api', 'db', 'sequelize.js');
const migratePath = path.join(process.cwd(), 'api', 'db', 'migrate.js');
const seedPath = path.join(process.cwd(), 'api', 'db', 'seed.js');
const modelsPath = path.join(process.cwd(), 'api', 'db', 'models', 'index.js');
const tenantServicePath = path.join(process.cwd(), 'api', 'services', 'tenantService.js');
const authServicePath = path.join(process.cwd(), 'api', 'services', 'authService.js');
const queueServicePath = path.join(process.cwd(), 'api', 'services', 'queueService.js');
const departmentsServicePath = path.join(process.cwd(), 'api', 'services', 'departmentsService.js');
const quickRepliesServicePath = path.join(process.cwd(), 'api', 'services', 'quickRepliesService.js');
const webhookServicePath = path.join(process.cwd(), 'api', 'services', 'webhookService.js');
const ragDocumentsServicePath = path.join(process.cwd(), 'api', 'services', 'ragDocumentsService.js');

const { detectProcessManager } = require('../../api/runtime/processManager');
const { createStartInitialization } = require('../../api/bootstrap/startInitialization');
const { startServerRuntime } = require('../../api/runtime/startServerRuntime');
const { registerShutdownHooks } = require('../../api/runtime/registerShutdownHooks');
const {
  createFlowRuntimeState,
  validateFlowStructure,
  ensureFlowHasMeta,
} = require('../../api/runtime/flowRuntimeState');

describe('server runtime modules', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
    jest.unmock(sequelizePath);
    jest.unmock(migratePath);
    jest.unmock(seedPath);
    jest.unmock(modelsPath);
    jest.unmock(tenantServicePath);
    jest.unmock(authServicePath);
    jest.unmock(queueServicePath);
    jest.unmock(departmentsServicePath);
    jest.unmock(quickRepliesServicePath);
    jest.unmock(webhookServicePath);
    jest.unmock(ragDocumentsServicePath);
  });

  test('detectProcessManager returns none when no manager is detected', () => {
    const result = detectProcessManager({
      env: {},
      argv: ['node', 'api/server.js'],
      ppid: 0,
      platform: 'linux',
    });

    expect(result.name).toBe('none');
    expect(result.hasProcessManager).toBe(false);
  });

  test('detectProcessManager detects nodemon via argv', () => {
    const result = detectProcessManager({
      env: {},
      argv: ['node', 'nodemon', 'api/server.js'],
      ppid: 0,
      platform: 'linux',
    });

    expect(result.name).toBe('nodemon');
    expect(result.hasProcessManager).toBe(true);
  });

  test('startServerRuntime starts server after initialization and workers', async () => {
    const messages = [];
    const loggerError = jest.fn();
    const server = { listen: jest.fn((port, cb) => cb()) };

    // DEFEITO PRÉ-EXISTENTE NA TRUNK (medido 2026-10-02): este mock era `{ exit: jest.fn() }` —
    // um objeto que NÃO é um process — enquanto `startServerRuntime` registra
    // `processRef.on('unhandledRejection')`. Resultado: `TypeError: processRef.on is not a
    // function` e o gate oficial de pré-commit (`npm run test:unit`) vermelho na trunk.
    //
    // O `on` do fonte não é acidente: veio do fix de um incidente real (commit 9c4e5945) em que
    // uma rejeição não tratada de integração OPCIONAL derrubava a API multi-tenant, levando junto
    // o converge/mesh de ~40 min que ficou pendurado esperando um processo morto. O mock passa a
    // ser fiel ao contrato e, em vez de apenas tolerar o hardening, o teste VERIFICA que a
    // rejeição é registrada e que o processo NÃO morre — a garantia que o fix existe para dar.
    const handlers = {};
    const processRef = { exit: jest.fn(), on: jest.fn((event, fn) => { handlers[event] = fn; }) };

    const result = await startServerRuntime({
      logger: { info: (...args) => messages.push(args), error: loggerError },
      clearLimitersCache: jest.fn(),
      startInitialization: jest.fn().mockResolvedValue(undefined),
      getOrCreateServer: jest.fn(() => server),
      port: 3030,
      startWorkers: jest.fn(),
      workerDeps: { logger: true },
      processRef,
    });

    expect(result).toBe(server);
    expect(server.listen).toHaveBeenCalledWith(3030, expect.any(Function));

    expect(typeof handlers.unhandledRejection).toBe('function');
    handlers.unhandledRejection(new Error('rejeição de integração opcional'));
    expect(loggerError).toHaveBeenCalled();
    expect(processRef.exit).not.toHaveBeenCalled();
  });

  test('startServerRuntime exits process when initialization fails', async () => {
    // Mesmo contrato do teste anterior: o processRef precisa ter `on` porque
    // `startServerRuntime` registra o handler de `unhandledRejection` ANTES de inicializar.
    const processRef = { exit: jest.fn(), on: jest.fn() };

    const result = await startServerRuntime({
      logger: { info: jest.fn(), error: jest.fn() },
      clearLimitersCache: jest.fn(),
      startInitialization: jest.fn().mockRejectedValue(new Error('boom')),
      getOrCreateServer: jest.fn(),
      port: 3030,
      startWorkers: jest.fn(),
      workerDeps: {},
      processRef,
    });

    expect(result).toBeNull();
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });

  test('flow runtime validators keep canonical constraints', () => {
    expect(validateFlowStructure({ nodes: [] })).toEqual({
      valid: false,
      error: 'Flow deve ter pelo menos um nó',
    });

    const flow = ensureFlowHasMeta({ nodes: [{ id: 'n1' }], name: 'Meu Fluxo' }, 'tenant-a');
    expect(flow.tenantId).toBe('tenant-a');
    expect(flow.name).toBe('Meu Fluxo');
    expect(flow.id).toMatch(/^meu-fluxo-/);
    expect(flow.version).toBe(1);
  });

  test('createFlowRuntimeState exposes shared maps and no-op session persistence', () => {
    const state = createFlowRuntimeState({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    });

    state.sessionEvents.set('s1', [{ timestamp: new Date().toISOString() }]);
    state.saveSessionEventsToFile();
    state.saveSessionEventsToFileImmediate();

    expect(state.flows).toBeInstanceOf(Map);
    expect(state.sessionEvents).toBeInstanceOf(Map);
    expect(state.sessionEvents.has('s1')).toBe(true);
  });

  test('startInitialization is idempotent and reuses the same promise while bootstrapping', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const connect = jest.fn().mockResolvedValue(undefined);
    const runMigrations = jest.fn().mockResolvedValue(undefined);
    const runSeed = jest.fn().mockResolvedValue(undefined);
    const defineRelationships = jest.fn();
    const initializeTenantContexts = jest.fn().mockResolvedValue(undefined);
    const initializeAuthService = jest.fn().mockResolvedValue(undefined);
    const initializeQueueService = jest.fn().mockResolvedValue(undefined);
    const initializeDepartments = jest.fn().mockResolvedValue(undefined);
    const initializeQuickReplies = jest.fn().mockResolvedValue(undefined);
    const initializeWebhooks = jest.fn().mockResolvedValue(undefined);
    const initializeRagDocuments = jest.fn().mockResolvedValue(undefined);
    const initializeSystemAdmin = jest.fn().mockResolvedValue(undefined);
    const loadFlowsFromDb = jest.fn().mockResolvedValue(undefined);
    const queueDefinitionService = { initialize: jest.fn().mockResolvedValue(undefined) };
    const closeReasonsService = { initialize: jest.fn().mockResolvedValue(undefined) };
    const flowTemplateMarketplaceService = { initialize: jest.fn().mockResolvedValue(undefined) };
    const initializeAiProviders = jest.fn().mockResolvedValue(undefined);
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    jest.doMock(sequelizePath, () => ({ connect }));
    jest.doMock(migratePath, () => ({ runMigrations }));
    jest.doMock(seedPath, () => ({ runSeed }));
    jest.doMock(modelsPath, () => ({ defineRelationships }));
    jest.doMock(tenantServicePath, () => ({ initializeTenantContexts }));
    jest.doMock(authServicePath, () => ({ initialize: initializeAuthService }));
    jest.doMock(queueServicePath, () => ({ initialize: initializeQueueService }));
    jest.doMock(departmentsServicePath, () => ({ initialize: initializeDepartments }));
    jest.doMock(quickRepliesServicePath, () => ({ initialize: initializeQuickReplies }));
    jest.doMock(webhookServicePath, () => ({ initialize: initializeWebhooks }));
    jest.doMock(ragDocumentsServicePath, () => ({ initialize: initializeRagDocuments }));

    const startInitialization = createStartInitialization({
      logger,
      initializeSystemAdmin,
      loadFlowsFromDb,
      queueDefinitionService,
      closeReasonsService,
      flowTemplateMarketplaceService,
      initializeAiProviders,
    });

    const firstPromise = startInitialization();
    const secondPromise = startInitialization();
    expect(connect).toHaveBeenCalledTimes(0);

    await jest.advanceTimersByTimeAsync(500);
    await Promise.all([firstPromise, secondPromise]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(runSeed).toHaveBeenCalledTimes(1);
    expect(defineRelationships).toHaveBeenCalledTimes(1);
    expect(initializeSystemAdmin).toHaveBeenCalledTimes(1);
    expect(loadFlowsFromDb).toHaveBeenCalledTimes(1);
    expect(initializeTenantContexts).toHaveBeenCalledTimes(1);
    expect(initializeAuthService).toHaveBeenCalledTimes(1);
    expect(initializeQueueService).toHaveBeenCalledTimes(1);
    expect(initializeDepartments).toHaveBeenCalledTimes(1);
    expect(initializeQuickReplies).toHaveBeenCalledTimes(1);
    expect(initializeWebhooks).toHaveBeenCalledTimes(1);
    expect(initializeRagDocuments).toHaveBeenCalledTimes(1);
    expect(queueDefinitionService.initialize).toHaveBeenCalledTimes(1);
    expect(closeReasonsService.initialize).toHaveBeenCalledTimes(1);
    expect(flowTemplateMarketplaceService.initialize).toHaveBeenCalledTimes(1);
    expect(initializeAiProviders).toHaveBeenCalledTimes(1);
  });

  test('registerShutdownHooks persists sessions and stops outbound worker on shutdown signals', () => {
    const handlers = {};
    const processRef = {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      exit: jest.fn(),
    };
    const outboundWorker = { stop: jest.fn() };
    const saveSessionEventsToFileImmediate = jest.fn();
    const logger = { info: jest.fn() };

    registerShutdownHooks({
      logger,
      outboundWorker,
      saveSessionEventsToFileImmediate,
      processRef,
    });

    expect(processRef.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processRef.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processRef.on).toHaveBeenCalledWith('beforeExit', expect.any(Function));

    handlers.SIGINT();
    expect(outboundWorker.stop).toHaveBeenCalledTimes(1);
    expect(saveSessionEventsToFileImmediate).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(0);

    handlers.beforeExit();
    expect(saveSessionEventsToFileImmediate).toHaveBeenCalledTimes(2);
  });
});
